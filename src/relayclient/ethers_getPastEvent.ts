
// create Topic2Prep map for a contract
// (note that a single map can be merged and used for all contracts)
import { Contract } from 'ethers'
import { Filter, Log } from 'ethers/providers'

// for each of the filters (events) of this contract,
// return a map from topic string to a "prepareEvent" function.
export interface LogEvent extends Log {
  event: string
  args: {}
}

type Log2LogEvent = (e: Log) => LogEvent;

// apply the right prep function to this event, based on its topic
function prepareEvent (event: Log, topic2prep: any): LogEvent {
  const eventTopic = event.topics[0]
  const prepareThisEvent = topic2prep[eventTopic]
  if (prepareThisEvent !== undefined) {
    return prepareThisEvent(event)
  }
  throw new Error('unknown topic: ' + eventTopic)
}

// that function takes a log entry and adds eventName, args
function getTopic2prep (contract: Contract): Map<string, Log2LogEvent> {
  // prepareEvent handles params, but doesn't add actual event name,
  // which is unfortunate. Also, it returns a weird array: parameters are in sequence,
  // and ENTIRE event is added as last param of the array - with normal "args" member
  // containing all params. so this wrapper unwraps this mess, and adds event name
  function prepWrapper (eventName: string, prepareEvent: (e: Event) => Log[]) {
    return (e: any) => {
      const p = prepareEvent(e)
      return { event: eventName, ...p[p.length - 1] }
    }
  }

  // map topic of an event into a "prepare" method.
  // can be done once per contract class.
  // @ts-ignore
  return Object.keys(contract.filters)
    .filter(eventName => !/[(]/.test(eventName)) // remove entries with params: EventName(arg,arg)
    .map(eventName => {
      const filter = contract.filters[eventName]() // create a filter for that event
      return [
        // @ts-ignore
        filter.topics[0], // first topic
        // @ts-ignore
        prepWrapper(eventName, contract._getEventFilter(filter).prepareEvent) // function to map params
      ]
    })
  // @ts-ignore
    .reduce((set, [k, v]) => ({ ...set, [k]: v }), {}) // convert array of [k,v] into a map
}

// contract - the contract to use (should be the "this" of this method, but, well..)
// filters = contract.filters.MyEvent()
// options - extra options (e.g. fromBlock, toBlock. don't include "topics")
export async function ethersGetPastEvents (contract: Contract, filters: any[], extraTopics: string[], options: Filter): Promise<LogEvent[]> {
  const topic2prep = getTopic2prep(contract)
  function filter2topic (filterOrName: any): string {
    if (typeof filterOrName === 'string') {
      const found = Object.entries(contract.filters).find(([name, val]) => name === filterOrName)
      if (found == null) {
        throw new Error('no such filter: ' + filterOrName)
      }
      const topics = found[1]().topics
      // @ts-ignore
      return topics[0]
    }
    if (typeof filterOrName === 'function') { return filterOrName().topics[0] }

    if (filterOrName == null) { throw new Error('unexpected null event') }
    assert(filterOrName.topics != null)
    return filterOrName.topics[0]
  }
  const topics = []
  topics.push(filters.map(filter2topic))
  if (extraTopics.length > 0) {
    topics.push(extraTopics)
  }

  const getLogOptions = { topics, address: contract.address, ...options }
  const logs = await contract.provider.getLogs(getLogOptions)
  return logs.map(log => prepareEvent(log, topic2prep))
}
