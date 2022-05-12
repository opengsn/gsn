/* eslint-disable no-global-assign */

import { CircularLogBuffer } from '@opengsn/relay/dist/CircularLogBuffer'
import sinon from 'sinon'
import { Logger } from 'winston'
import { createServerLogger } from '@opengsn/relay/dist/ServerWinstonLogger'

describe.only('CircularLogBuffer', () => {
  let logger: Logger
  before(function () {
    logger = createServerLogger('debug', '', '')
  })

  it('should do whatever', function () {
    const logBuffer = new CircularLogBuffer(5)
    appendIteration(logBuffer, 0)
    appendIteration(logBuffer, 1)
    appendIteration(logBuffer, 2)
    appendIteration(logBuffer, 3)
    appendIteration(logBuffer, 4)
    appendIteration(logBuffer, 5)
    appendIteration(logBuffer, 6)
    assert.deepEqual(logBuffer.logs,
      [
        [
          ['debug', 'iteration 5, debug 0'],
          ['debug', 'iteration 5, debug 1'],
          ['debug', 'iteration 5, debug 2'],
          ['info', 'iteration 5, info 0'],
          ['error', 'iteration 5, error 0'],
          ['info', 'iteration 5, info 1'],
          ['warn', 'iteration 5, warn 0']
        ],
        [
          ['debug', 'iteration 6, debug 0'],
          ['debug', 'iteration 6, debug 1'],
          ['debug', 'iteration 6, debug 2'],
          ['info', 'iteration 6, info 0'],
          ['error', 'iteration 6, error 0'],
          ['info', 'iteration 6, info 1'],
          ['warn', 'iteration 6, warn 0']
        ],
        [],
        [
          ['debug', 'iteration 3, debug 0'],
          ['debug', 'iteration 3, debug 1'],
          ['debug', 'iteration 3, debug 2'],
          ['info', 'iteration 3, info 0'],
          ['error', 'iteration 3, error 0'],
          ['info', 'iteration 3, info 1'],
          ['warn', 'iteration 3, warn 0']
        ],
        [
          ['debug', 'iteration 4, debug 0'],
          ['debug', 'iteration 4, debug 1'],
          ['debug', 'iteration 4, debug 2'],
          ['info', 'iteration 4, info 0'],
          ['error', 'iteration 4, error 0'],
          ['info', 'iteration 4, info 1'],
          ['warn', 'iteration 4, warn 0']
        ]
      ]
    )
    const spy = sinon.spy(logger, 'debug')
    logBuffer.log(logger)
    const calls = spy.getCalls()
    console.log('parsing calls', calls[0])
  })

  function appendIteration (logBuffer: CircularLogBuffer, iteration: number): void {
    logBuffer.append('debug', `iteration ${iteration}, debug 0`)
    logBuffer.append('debug', `iteration ${iteration}, debug 1`)
    logBuffer.append('debug', `iteration ${iteration}, debug 2`)
    logBuffer.append('info', `iteration ${iteration}, info 0`)
    logBuffer.append('error', `iteration ${iteration}, error 0`)
    logBuffer.append('info', `iteration ${iteration}, info 1`)
    logBuffer.append('warn', `iteration ${iteration}, warn 0`)
    logBuffer.nextIteration()
  }
})
