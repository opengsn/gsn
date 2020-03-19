const BN = require('web3').utils.toBN

const { event2topic } = require('./utils')
// relays are "down-scored" in case they timed out a request.
// they are "forgiven" after this timeout.
const DEFAULT_RELAY_TIMEOUT_GRACE_SEC = 60 * 30

// assume veri high stake values for preferred relays, so we don't need
// to change the filter logic to always support them.
const PREFERRED_STAKE = 1e30
const PREFERRED_DELAY = 1e10
class ActiveRelayPinger {
  // TODO: 'httpSend' should be on a network layer
  constructor (filteredRelays, httpSend, gasPrice, verbose, nextPinger) {
    this.remainingRelays = filteredRelays.slice()
    this.httpSend = httpSend
    this.pingedRelays = 0
    this.relaysCount = filteredRelays.length
    this.gasPrice = gasPrice
    this.verbose = verbose
    this.nextPinger = nextPinger
  }

  /**
   * Ping those relays that were not returned yet. Remove the returned relay (first to respond) from {@link remainingRelays}
   * @returns the first relay to respond to a ping message. Note: will never return the same relay twice.
   */
  async nextRelay () {
    let ret = await this._nextRelayInternal()
    // only if no relay found in this ActivePinger, start using the next ActivePinger
    if (!ret && this.nextPinger) {
      ret = await this.nextPinger.nextRelay()
    }
    return ret
  }

  async _nextRelayInternal () {
    while (this.remainingRelays.length) {
      const bulkSize = Math.min(3, this.remainingRelays.length)
      try {
        const slice = this.remainingRelays.slice(0, bulkSize)
        if (this.verbose) {
          console.log('nextRelay: find fastest relay from: ' + JSON.stringify(slice))
        }
        const firstRelayToRespond = await this.raceToSuccess(
          slice
            .map(relay => this.getRelayAddressPing(relay.relayUrl, relay.baseRelayFee, relay.pctRelayFee, this.gasPrice))
        )
        if (this.verbose) {
          console.log('race finished with a champion: ' + firstRelayToRespond.relayUrl)
        }
        this.remainingRelays = this.remainingRelays.filter(a => a.relayUrl !== firstRelayToRespond.relayUrl)
        this.pingedRelays++
        return firstRelayToRespond
      } catch (e) {
        console.log('One batch of relays failed, last error: ', e)
        // none of the first `bulkSize` items matched. remove them, to continue with the next bulk.
        this.remainingRelays = this.remainingRelays.slice(bulkSize)
      }
    }
  }

  /**
   * @returns JSON response from the relay server, but adds the requested URL to it :'-(
   */
  async getRelayAddressPing (relayUrl, baseRelayFee, pctRelayFee, gasPrice) {
    const self = this
    return new Promise(function (resolve, reject) {
      const callback = function (error, body) {
        if (self.verbose) {
          console.log('error, body', error, body)
        }
        if (error) {
          reject(error)
          return
        }
        if (!body) {
          reject(Error('Relay responded without a body'))
          return
        }
        if (!body.Ready) {
          reject(Error('Relay not ready ' + JSON.stringify(body)))
          return
        }
        if ( body.MinGasPrice > gasPrice) {
          reject(Error(`Proposed gas price too low: ${gasPrice}, relay's gasPrice: ${body.MinGasPrice}`))
          return
        }
        try {
          // add extra attributes
          // TODO: now this is a bad architecture! refactor!
          Object.assign(body, { relayUrl, baseRelayFee, pctRelayFee })
          resolve(body)
        } catch (err) {
          reject(err)
        }
      }
      if (self.verbose) {
        console.log('getRelayAddressPing URL: ' + relayUrl)
      }
      self.httpSend.send(relayUrl + '/getaddr', {}, callback)
    })
  }

  /**
   * From https://stackoverflow.com/a/37235207 (modified to catch exceptions)
   * Resolves once any promise resolves, ignores the rest, ignores rejections
   */
  async raceToSuccess (promises) {
    let numRejected = 0
    return new Promise(
      (resolve, reject) =>
        promises.forEach(
          promise =>
            promise.then((res) => {
              resolve(res)
            }).catch(err => {
              if (++numRejected === promises.length) {
                reject(Error('No response matched filter from any server: ' + JSON.stringify(err.message)))
              }
            })
        )
    )
  }
}

class ServerHelper {
  constructor (httpSend, failedRelays,
    {
      verbose,
      preferredRelays, // URLs of relays to use always first, before any globally found relays
      minStake, minDelay, // params for relayFilter: filter out this relay if unstakeDelay or stake are too low.
      relayTimeoutGrace, // ignore score drop of a relay after this time (seconds)
      calculateRelayScore, // function: return relay score, higher the better. default uses transaction fees and some randomness
      relayFilter, // function: return false to filter out a relay. default uses minStake, minDelay
      addScoreRandomness // function: return Math.random (0..1), to fairly distribute among relays with same score.
      // (used by test to REMOVE the randomness, and make the test deterministic.
    }) {
    this.httpSend = httpSend
    if (typeof preferredRelays !== 'undefined') {
      this.preferredRelays = Array.isArray(preferredRelays) ? preferredRelays : [preferredRelays]
    }
    this.verbose = verbose
    this.failedRelays = failedRelays
    this.relayTimeoutGrace = relayTimeoutGrace || DEFAULT_RELAY_TIMEOUT_GRACE_SEC

    this.addScoreRandomness = addScoreRandomness || Math.random

    this.calculateRelayScore = calculateRelayScore || this.defaultCalculateRelayScore.bind(this)

    // default filter: either calculateRelayScore didn't set "score" field,
    // or if unstakeDelay is below min, or if stake is below min.
    this.relayFilter = relayFilter || ((relay) => (
      relay.score != null &&
      (!minDelay || BN(relay.unstakeDelay).gte(BN(minDelay))) &&
      (!minStake || BN(relay.stake).gte(BN(minStake)))
    ))

    this.filteredRelays = []
    this.isInitialized = false
    this.ActiveRelayPinger = ActiveRelayPinger
  }

  defaultCalculateRelayScore (relay) {
    // basic score is trasnaction fee (which is %)
    // higher the better.
    let score = 1000 - relay.pctRelayFee

    const failedRelay = this.failedRelays[relay.relayUrl]
    if (failedRelay) {
      const elapsed = (new Date().getTime() - failedRelay.lastError) / 1000
      // relay failed to answer lately. demote.
      if (elapsed < this.relayTimeoutGrace) {
        score -= 10
      } else {
        delete this.failedRelays[relay.relayUrl]
      }
    }

    return score
  }

  // compare relay scores.
  // if they are the same, use addScoreRandomness to shuffle them..
  compareRelayScores (r1, r2) {
    const diff = r2.score - r1.score
    if (diff) { return diff }
    return this.addScoreRandomness() - 0.5
  }

  /**
   *
   * @param {*} relayHubInstance
   */
  setHub (relayHubInstance) {
    if (this.relayHubInstance !== relayHubInstance) {
      this.filteredRelays = []
    }
    this.relayHubInstance = relayHubInstance
  }

  async newActiveRelayPinger (fromBlock, gasPrice) {
    if (typeof this.relayHubInstance === 'undefined') {
      throw new Error('Must call to setHub first!')
    }
    if (this.filteredRelays.length === 0 || this.fromBlock !== fromBlock) {
      this.fromBlock = fromBlock
      await this.fetchRelaysAdded()
    }
    return this.createActiveRelayPinger(this.filteredRelays, this.httpSend, gasPrice, this.verbose, this.preferredRelays)
  }

  createActiveRelayPinger (filteredRelays, httpSend, gasPrice, verbose, preferredRelays) {
    let pinger = new ActiveRelayPinger(filteredRelays, httpSend, gasPrice, verbose)
    if (preferredRelays) {
      const prefs = this.preferredRelays.map(relayUrl => ({
        relayUrl,
        transactionFee: 0,
        stake: PREFERRED_STAKE,
        unstakeDelay: PREFERRED_DELAY
      })
      )
      // if there are preferred relays, create a pinger that uses them FIRST, and only
      // falls-back to the "normal" pinger, based on the filtered list.
      pinger = new ActiveRelayPinger(prefs, httpSend, gasPrice, verbose, pinger)
    }
    return pinger
  }

  /**
   * Iterates through all RelayAdded and RelayRemoved logs emitted by given hub
   * initializes an array {@link filteredRelays} of relays curently registered on given RelayHub contract
   */
  async fetchRelaysAdded () {
    this.verbose = true
    const fromBlock = this.fromBlock || 2
    const eventTopics = event2topic(this.relayHubInstance,
      ['RelayAdded', 'RelayRemoved', 'TransactionRelayed', 'CanRelayFailed'])

    const relayEvents = await this.relayHubInstance.getPastEvents('allEvents', {
      fromBlock: fromBlock,
      topics: [eventTopics]
    })

    if (this.verbose) {
      console.log('fetchRelaysAdded: found ', relayEvents.length + ' events')
    }
    const foundRelays = new Set()
    relayEvents.forEach(event => {
      if (event.event === 'RelayRemoved') {
        foundRelays.delete(event.returnValues.relay)
      } else {
        foundRelays.add(event.returnValues.relay)
      }
    })

    if (this.verbose) {
      console.log('fetchRelaysAdded: found', Object.keys(foundRelays).length, 'unique relays')
    }

    const relayAddedTopic = event2topic(this.relayHubInstance, 'RelayAdded')

    function toBytes32 (addr) {
      return '0x' + addr.replace(/^0x/, '').padStart(64, '0').toLowerCase()
    }
    // found all addresses. 2nd round to get the RelayAdded event for each of those relays.
    // TODO: at least some of the found relays above was due to "RelayAdded" event,
    // we _could_ optimize for that, but since at least _some_ relays
    // were found by the TransactionRelayed event, we are forced to search them
    // for actual address.
    const relayAddedEvents = await this.relayHubInstance.getPastEvents('RelayAdded', {
      fromBlock: 1,
      topics: [relayAddedTopic, Array.from(foundRelays, toBytes32)]
    })

    if (this.verbose) {
      console.log('== fetchRelaysAdded: found ', relayAddedEvents.length + ' unique RelayAdded events (should have at least as unique relays, above)')
    }

    const activeRelays = {}
    relayAddedEvents.forEach(event => {
      const args = event.returnValues
      const relay = {
        address: args.relay,
        relayUrl: args.url,
        baseRelayFee: args.baseRelayFee,
        pctRelayFee: args.pctRelayFee,
        stake: args.stake,
        unstakeDelay: args.unstakeDelay
      }
      relay.score = this.calculateRelayScore(relay)
      activeRelays[args.relay] = relay
    })
    const origRelays = Object.values(activeRelays)
    const filteredRelays = origRelays.filter(this.relayFilter).sort(this.compareRelayScores.bind(this))

    if (filteredRelays.length === 0) {
      throw new Error('no valid relays. orig relays=' + JSON.stringify(origRelays))
    }

    if (this.verbose) {
      console.log('fetchRelaysAdded: after filtering have ' + filteredRelays.length + ' active relays')
    }

    this.filteredRelays = filteredRelays
    this.isInitialized = true
    return filteredRelays
  }
}

module.exports = ServerHelper
