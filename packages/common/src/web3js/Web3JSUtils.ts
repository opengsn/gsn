/* eslint-disable */
// @ts-nocheck

// Utilities from Web3.js library that need to be replaced

import BN from 'bn.js'
import numberToBN from 'number-to-bn'
import ethjsUnit from 'ethjs-unit'

/**
 * Takes an input and transforms it into an BN
 *
 * @method toBN
 * @param {Number|String|BN} number, string, HEX string or BN
 * @return {BN} BN
 */
export var toBN = function (number): BN {
  try {
    return numberToBN.apply(null, arguments)
  } catch (e) {
    throw new Error(e + ' Given value: "' + number + '"')
  }
}

export function isBigNumber (object: Object): boolean {
  return object?.constructor?.name === 'BigNumber' || object?.constructor?.name === 'BN'
}

/**
 * Auto converts any given value into it's hex representation.
 *
 * And even stringifys objects before.
 *
 * @method toHex
 * @param {String|Number|BN|Object|Buffer} value
 * @param {Boolean} returnType
 * @return {String}
 */
export var toHex = function (value, returnType?: any) {
  /*jshint maxcomplexity: false */

  if (isAddress(value)) {
    return returnType ? 'address' : '0x' + value.toLowerCase().replace(/^0x/i, '')
  }

  if (typeof value === 'boolean') {
    return returnType ? 'bool' : value ? '0x01' : '0x00'
  }

  if (Buffer.isBuffer(value)) {
    return '0x' + value.toString('hex')
  }

  if (typeof value === 'object' && !!value && !isBigNumber(value) && !isBN(value)) {
    return returnType ? 'string' : utf8ToHex(JSON.stringify(value))
  }

  // if its a negative number, pass it through numberToHex
  if (typeof value === 'string') {
    if (value.indexOf('-0x') === 0 || value.indexOf('-0X') === 0) {
      return returnType ? 'int256' : numberToHex(value)
    } else if (value.indexOf('0x') === 0 || value.indexOf('0X') === 0) {
      return returnType ? 'bytes' : value
    } else if (!isFinite(value)) {
      return returnType ? 'string' : utf8ToHex(value)
    }
  }

  return returnType ? (value < 0 ? 'int256' : 'uint256') : numberToHex(value)
}

/**
 * Converts value to it's hex representation
 *
 * @method numberToHex
 * @param {String|Number|BN} value
 * @return {String}
 */
var numberToHex = function (value) {
  if ((value === null || value === undefined)) {
    return value
  }

  if (!isFinite(value) && !isHexStrict(value)) {
    throw new Error('Given input "' + value + '" is not a number.')
  }

  var number = toBN(value)
  var result = number.toString(16)

  return number.lt(new BN(0)) ? '-0x' + result.slice(1) : '0x' + result
}

/**
 * Checks if the given string is an address
 *
 * @method isAddress
 * @param {String} address the given HEX address
 * @return {Boolean}
 */
var isAddress = function (address) {
  // check if it has the basic requirements of an address
  if (!/^(0x)?[0-9a-f]{40}$/i.test(address)) {
    return false
    // If it's ALL lowercase or ALL upppercase
  } else if (/^(0x|0X)?[0-9a-f]{40}$/.test(address) || /^(0x|0X)?[0-9A-F]{40}$/.test(address)) {
    return true
    // Otherwise check each case
  } else {
    return checkAddressChecksum(address)
  }
}

// TODO TODO!!!
var checkAddressChecksum = function (address) {
  return true
}

/**
 * Check if string is HEX, requires a 0x in front
 *
 * @method isHexStrict
 * @param {String} hex to be checked
 * @returns {Boolean}
 */
var isHexStrict = function (hex) {
  return ((typeof hex === 'string' || typeof hex === 'number') && /^(-)?0x[0-9a-f]*$/i.test(hex))
}

/**
 * Takes a number of a unit and converts it to wei.
 *
 * Possible units are:
 *   SI Short   SI Full        Effigy       Other
 * - kwei       femtoether     babbage
 * - mwei       picoether      lovelace
 * - gwei       nanoether      shannon      nano
 * - --         microether     szabo        micro
 * - --         microether     szabo        micro
 * - --         milliether     finney       milli
 * - ether      --             --
 * - kether                    --           grand
 * - mether
 * - gether
 * - tether
 *
 * @method toWei
 * @param {Number|String|BN} number can be a number, number string or a HEX of a decimal
 * @param {String} unit the unit to convert from, default ether
 * @return {String|Object} When given a BN object it returns one as well, otherwise a number
 */
export var toWei = function (number, unit) {
  unit = getUnitValue(unit)

  if (!isBN(number) && !(typeof number === 'string')) {
    throw new Error('Please pass numbers as strings or BN objects to avoid precision errors.')
  }

  return isBN(number) ? ethjsUnit.toWei(number, unit) : ethjsUnit.toWei(number, unit).toString(10)
}

/**
 * Takes a number of wei and converts it to any other ether unit.
 *
 * Possible units are:
 *   SI Short   SI Full        Effigy       Other
 * - kwei       femtoether     babbage
 * - mwei       picoether      lovelace
 * - gwei       nanoether      shannon      nano
 * - --         microether     szabo        micro
 * - --         milliether     finney       milli
 * - ether      --             --
 * - kether                    --           grand
 * - mether
 * - gether
 * - tether
 *
 * @method fromWei
 * @param {Number|String} number can be a number, number string or a HEX of a decimal
 * @param {String} unit the unit to convert to, default ether
 * @return {String|Object} When given a BN object it returns one as well, otherwise a number
 */
export var fromWei = function (number, unit?: any): string {
  unit = getUnitValue(unit)

  if (!isBN(number) && !(typeof number === 'string')) {
    throw new Error('Please pass numbers as strings or BN objects to avoid precision errors.')
  }

  return ethjsUnit.fromWei(number, unit).toString(10)
}

/**
 * Returns true if object is BN, otherwise false
 *
 * @method isBN
 * @param {Object} object
 * @return {Boolean}
 */
var isBN = function (object) {
  return BN.isBN(object)
}
/**
 * Returns value of unit in Wei
 *
 * @method getUnitValue
 * @param {String} unit the unit to convert to, default ether
 * @returns {BN} value of the unit (in Wei)
 * @throws error if the unit is not correct:w
 */
export var getUnitValue = function (unit) {
  unit = unit ? unit.toLowerCase() : 'ether'
  if (!ethjsUnit.unitMap[unit]) {
    throw new Error('This unit "' + unit + '" doesn\'t exist, please use the one of the following units' + JSON.stringify(ethjsUnit.unitMap, null, 2))
  }
  return unit
}
