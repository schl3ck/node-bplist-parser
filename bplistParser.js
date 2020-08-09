/* eslint-disable no-console */
/* global console */

'use strict';

// adapted from https://github.com/3breadt/dd-plist

const debug = false;

const maxObjectSize = 100 * 1000 * 1000; // 100Meg
const maxObjectCount = 32768;

// EPOCH = new SimpleDateFormat("yyyy MM dd zzz").parse("2001 01 01 GMT").getTime();
// ...but that's annoying in a static initializer because it can throw exceptions, ick.
// So we just hardcode the correct value.
const EPOCH = 978307200000;

// UID object definition
class UID {
  constructor(id) {
    this.UID = id;
  }
}

/**
 * @param {Uint8Array} buffer The Array buffer
 * @returns {void}
 */
function parseBuffer(buffer) {
  if (!(buffer instanceof Uint8Array)) {
    buffer = new Uint8Array(buffer);
  }
  // check header
  const header = buffer.slice(0, 'bplist'.length).toString();
  if (header !== 'bplist') {
    throw new Error("Invalid binary plist. Expected 'bplist' at offset 0.");
  }

  // Handle trailer, last 32 bytes of the file
  const trailer = buffer.slice(buffer.length - 32);
  // 6 null bytes (index 0 to 5)
  const offsetSize = readUInt8(trailer, 6);
  if (debug) {
    console.log("parsing bplist");
    console.log("offsetSize: " + offsetSize);
  }
  const objectRefSize = readUInt8(trailer, 7);
  if (debug) {
    console.log("objectRefSize: " + objectRefSize);
  }
  const numObjects = readUInt64BE(trailer, 8);
  if (debug) {
    console.log("numObjects: " + numObjects);
  }
  const topObject = readUInt64BE(trailer, 16);
  if (debug) {
    console.log("topObject: " + topObject);
  }
  const offsetTableOffset = readUInt64BE(trailer, 24);
  if (debug) {
    console.log("offsetTableOffset: " + offsetTableOffset);
  }

  if (numObjects > maxObjectCount) {
    throw new Error("maxObjectCount exceeded");
  }

  // Handle offset table
  const offsetTable = [];

  for (let i = 0; i < numObjects; i++) {
    const offsetBytes = buffer.slice(offsetTableOffset + i * offsetSize, offsetTableOffset + (i + 1) * offsetSize);
    offsetTable[i] = readUInt(offsetBytes, 0);
    if (debug) {
      console.log("Offset for Object #" + i + " is " + offsetTable[i] + " [" + offsetTable[i].toString(16) + "]");
    }
  }

  // Parses an object inside the currently parsed binary property list.
  // For the format specification check
  // <a href="https://www.opensource.apple.com/source/CF/CF-635/CFBinaryPList.c">
  // Apple's binary property list parser implementation</a>.
  function parseObject(tableOffset) {
    const offset = offsetTable[tableOffset];
    const type = buffer[offset];
    const objType = (type & 0xF0) >> 4; //First  4 bits
    const objInfo = (type & 0x0F);      //Second 4 bits
    switch (objType) {
      case 0x0:
        return parseSimple();
      case 0x1:
        return parseInteger();
      case 0x8:
        return parseUID();
      case 0x2:
        return parseReal();
      case 0x3:
        return parseDate();
      case 0x4:
        return parseData();
      case 0x5: // ASCII
        return parsePlistString();
      case 0x6: // UTF-16
        return parsePlistString(true);
      case 0xA:
        return parseArray();
      case 0xD:
        return parseDictionary();
      default:
        throw new Error("Unhandled type 0x" + objType.toString(16));
    }

    function parseSimple() {
      //Simple
      switch (objInfo) {
        case 0x0: // null
          return null;
        case 0x8: // false
          return false;
        case 0x9: // true
          return true;
        case 0xF: // filler byte
          return null;
        default:
          throw new Error("Unhandled simple type 0x" + objType.toString(16));
      }
    }

    /**
     * @param {Uint8Array} buffer
     */
    function bufferToHexString(buffer) {
      let str = '';
      let i;
      for (i = 0; i < buffer.length; i++) {
        if (buffer[i] != 0x00) {
          break;
        }
      }
      for (; i < buffer.length; i++) {
        const part = '00' + buffer[i].toString(16);
        str += part.substr(part.length - 2);
      }
      return str;
    }

    function parseInteger() {
      const length = Math.pow(2, objInfo);

      if (objInfo == 0x4) {
        const data = buffer.slice(offset + 1, offset + 1 + length);
        const str = bufferToHexString(data);
        return parseInt(str, 16); // TODO: bigInt(str, 16) from big-integer
      }
      if (objInfo == 0x3) {
        return readInt32BE(buffer, offset + 1);
      }
      if (length < maxObjectSize) {
        return readUInt(buffer.slice(offset + 1, offset + 1 + length));
      }
      throw new Error("Too little heap space available! Wanted to read " + length + " bytes, but only " + maxObjectSize + " are available.");
    }

    function parseUID() {
      const length = objInfo + 1;
      if (length < maxObjectSize) {
        return new UID(readUInt(buffer.slice(offset + 1, offset + 1 + length)));
      }
      throw new Error("Too little heap space available! Wanted to read " + length + " bytes, but only " + maxObjectSize + " are available.");
    }

    function parseReal() {
      const length = Math.pow(2, objInfo);
      if (length < maxObjectSize) {
        const realBuffer = buffer.slice(offset + 1, offset + 1 + length);
        if (length === 4) {
          return readFloatBE(realBuffer, 0);
        }
        if (length === 8) {
          return readDoubleBE(realBuffer, 0);
        }
      } else {
        throw new Error("Too little heap space available! Wanted to read " + length + " bytes, but only " + maxObjectSize + " are available.");
      }
    }

    function parseDate() {
      if (objInfo != 0x3) {
        console.error("Unknown date type :" + objInfo + ". Parsing anyway...");
      }
      const dateBuffer = buffer.slice(offset + 1, offset + 9);
      return new Date(EPOCH + (1000 * readDoubleBE(dateBuffer, 0)));
    }

    function parseData() {
      let dataoffset = 1;
      let length = objInfo;
      if (objInfo == 0xF) {
        const int_type = buffer[offset + 1];
        const intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("0x4: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = int_type & 0x0F;
        const intLength = Math.pow(2, intInfo);
        dataoffset = 2 + intLength;
        if (intLength < 3) {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        } else {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        }
      }
      if (length < maxObjectSize) {
        return buffer.slice(offset + dataoffset, offset + dataoffset + length);
      }
      throw new Error("Too little heap space available! Wanted to read " + length + " bytes, but only " + maxObjectSize + " are available.");
    }

    function parsePlistString(isUtf16) {
      isUtf16 = isUtf16 || 0;
      let enc = "utf8";
      let length = objInfo;
      let stroffset = 1;
      if (objInfo == 0xF) {
        const int_type = buffer[offset + 1];
        const intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = int_type & 0x0F;
        const intLength = Math.pow(2, intInfo);
        stroffset = 2 + intLength;
        if (intLength < 3) {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        } else {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        }
      }
      // length is String length -> to get byte length multiply by 2, as 1 character takes 2 bytes in UTF-16
      length *= (isUtf16 + 1);
      if (length < maxObjectSize) {
        // slice copies the buffer
        let plistString = buffer.slice(offset + stroffset, offset + stroffset + length);
        if (isUtf16) plistString = swapBytes(plistString);
        enc = isUtf16
          ? "utf-16le"
          : "utf-8";
        const decoder = new TextDecoder(enc);
        return decoder.decode(plistString);
      }
      throw new Error("Too little heap space available! Wanted to read " + length + " bytes, but only " + maxObjectSize + " are available.");
    }

    function parseArray() {
      let length = objInfo;
      let arrayoffset = 1;
      if (objInfo == 0xF) {
        const int_type = buffer[offset + 1];
        const intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("0xa: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = int_type & 0x0F;
        const intLength = Math.pow(2, intInfo);
        arrayoffset = 2 + intLength;
        if (intLength < 3) {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        } else {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        }
      }
      if (length * objectRefSize > maxObjectSize) {
        throw new Error("Too little heap space available!");
      }
      const array = [];
      for (let i = 0; i < length; i++) {
        const objRef = readUInt(buffer.slice(offset + arrayoffset + i * objectRefSize, offset + arrayoffset + (i + 1) * objectRefSize));
        array[i] = parseObject(objRef);
      }
      return array;
    }

    function parseDictionary() {
      let length = objInfo;
      let dictoffset = 1;
      if (objInfo == 0xF) {
        const int_type = buffer[offset + 1];
        const intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("0xD: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        const intInfo = int_type & 0x0F;
        const intLength = Math.pow(2, intInfo);
        dictoffset = 2 + intLength;
        if (intLength < 3) {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        } else {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        }
      }
      if (length * 2 * objectRefSize > maxObjectSize) {
        throw new Error("Too little heap space available!");
      }
      if (debug) {
        console.log("Parsing dictionary #" + tableOffset);
      }
      const dict = {};
      for (let i = 0; i < length; i++) {
        const keyRef = readUInt(buffer.slice(offset + dictoffset + i * objectRefSize, offset + dictoffset + (i + 1) * objectRefSize));
        const valRef = readUInt(buffer.slice(offset + dictoffset + (length * objectRefSize) + i * objectRefSize, offset + dictoffset + (length * objectRefSize) + (i + 1) * objectRefSize));
        const key = parseObject(keyRef);
        const val = parseObject(valRef);
        if (debug) {
          console.log("  DICT #" + tableOffset + ": Mapped " + key + " to " + val);
        }
        dict[key] = val;
      }
      return dict;
    }
  }

  return [parseObject(topObject)];
}

/**
 * @param {ArrayBuffer} buffer
 * @param {number} start
 */
function readUInt(buffer, start = 0) {
  const buf = new Uint8Array(buffer, start);

  let l = 0;
  for (let i = start; i < buf.length; i++) {
    l <<= 8;
    l |= buf[i] & 0xFF;
  }
  return l;
}

// we're just going to toss the high order bits because javascript doesn't have 64-bit ints
/**
 * @param {Uint8Array} buffer
 * @param {number} start
 */
function readUInt64BE(buffer, start) {
  return new Uint32Array(buffer, start, 8)[1];
}

/**
 * @param {Uint8Array} buffer
 * @param {number} start
 */
function readInt32BE(buffer, start) {
  return new Int32Array(buffer, start, 8)[1];
}

/**
 * @param {Uint8Array} buffer
 * @param {number} start
 */
function readFloatBE(buffer, start) {
  return new Float32Array(buffer, start)[0];
}

/**
 * @param {Uint8Array} buffer
 * @param {number} start
 */
function readDoubleBE(buffer, start) {
  return new Float32Array(buffer, start)[0];
}

/**
 * @param {Uint8Array} buffer
 */
function swapBytes(buffer) {
  const len = buffer.length;
  for (let i = 0; i < len; i += 2) {
    const a = buffer[i];
    buffer[i] = buffer[i + 1];
    buffer[i + 1] = a;
  }
  return buffer;
}

/**
 * @param {Uint8Array} buffer The array buffer
 * @param {number} offset An integer offset
 */
function readUInt8(buffer, offset = 0) {
  return buffer[offset];
}
