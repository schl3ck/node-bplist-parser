'use strict';

// adapted from http://code.google.com/p/plist/source/browse/trunk/src/com/dd/plist/BinaryPropertyListParser.java

var fs = require('fs');
var debug = false;

exports.maxObjectSize = 100 * 1000 * 1000; // 100Meg

// EPOCH = new SimpleDateFormat("yyyy MM dd zzz").parse("2001 01 01 GMT").getTime();
// ...but that's annoying in a static initializer because it can throw exceptions, ick.
// So we just hardcode the correct value.
var EPOCH = 978307200000;

var parseFile = exports.parseFile = function (fileName, callback) {
  fs.readFile(fileName, function (err, data) {
    if (err) {
      return callback(err);
    }
    try {
      var result = parseBuffer(data);
      return callback(null, result);
    } catch (ex) {
      return callback(ex);
    }
  });
};

var parseBuffer = exports.parseBuffer = function (buffer) {
  var result = {};

  // check header
  var header = buffer.slice(0, 'bplist'.length).toString('utf8');
  if (header !== 'bplist') {
    throw new Error("Invalid binary plist. Expected 'bplist' at offset 0.");
  }

  // Handle trailer, last 32 bytes of the file
  var trailer = buffer.slice(buffer.length - 32, buffer.length);
  // 6 null bytes (index 0 to 5)
  var offsetSize = trailer.readUInt8(6);
  if (debug) {
    console.log("offsetSize: " + offsetSize);
  }
  var objectRefSize = trailer.readUInt8(7);
  if (debug) {
    console.log("objectRefSize: " + objectRefSize);
  }
  var numObjects = readUInt64BE(trailer, 8);
  if (debug) {
    console.log("numObjects: " + numObjects);
  }
  var topObject = readUInt64BE(trailer, 16);
  if (debug) {
    console.log("topObject: " + topObject);
  }
  var offsetTableOffset = readUInt64BE(trailer, 24);
  if (debug) {
    console.log("offsetTableOffset: " + offsetTableOffset);
  }

  // Handle offset table
  var offsetTable = [];

  for (var i = 0; i < numObjects; i++) {
    var offsetBytes = buffer.slice(offsetTableOffset + i * offsetSize, offsetTableOffset + (i + 1) * offsetSize);
    offsetTable[i] = readUInt(offsetBytes, 0);
    if (debug) {
      console.log("Offset for Object #" + i + " is " + offsetTable[i] + " [" + offsetTable[i].toString(16) + "]");
    }
  }

  // Parses an object inside the currently parsed binary property list.
  // For the format specification check
  // <a href="http://www.opensource.apple.com/source/CF/CF-635/CFBinaryPList.c">
  // Apple's binary property list parser implementation</a>.
  function parseObject(tableOffset) {
    var offset = offsetTable[tableOffset];
    var type = buffer[offset];
    var objType = (type & 0xF0) >> 4; //First  4 bits
    var objInfo = (type & 0x0F);      //Second 4 bits
    switch (objType) {
    case 0x0:
    {
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
      break;
    }
    case 0x1:
    {
      //integer
      var length = Math.pow(2, objInfo);
      if (length < exports.maxObjectSize) {
        return readUInt(buffer.slice(offset + 1, offset + 1 + length));
      } else {
        throw new Error("To little heap space available! Wanted to read " + length + " bytes, but only " + exports.maxObjectSize + " are available.");
      }
    }
    case 0x2:
    {
      //real
      var length = Math.pow(2, objInfo);
      if (length < exports.maxObjectSize) {
        var realBuffer = buffer.slice(offset + 1, offset + 1 + length);
        return realBuffer.readDoubleBE(0);
      } else {
        throw new Error("To little heap space available! Wanted to read " + length + " bytes, but only " + exports.maxObjectSize + " are available.");
      }
    }
    case 0x3:
    {
      //Date
      if (objInfo != 0x3) {
        console.error("Unknown date type :" + objInfo + ". Parsing anyway...");
      }
      var dateBuffer = buffer.slice(offset + 1, offset + 9);
      return new Date(EPOCH + (1000 * dateBuffer.readDoubleBE(0)));
    }
    case 0x4:
    {
      //Data
      var dataoffset = 1;
      var length = objInfo;
      if (objInfo == 0xF) {
        var int_type = buffer[offset + 1];
        var intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("0x4: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        var intInfo = int_type & 0x0F;
        var intLength = Math.pow(2, intInfo);
        dataoffset = 2 + intLength;
        if (intLength < 3) {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        } else {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        }
      }
      if (length < exports.maxObjectSize) {
        return buffer.slice(offset + dataoffset, offset + dataoffset + length);
      } else {
        throw new Error("To little heap space available! Wanted to read " + length + " bytes, but only " + exports.maxObjectSize + " are available.");
      }
    }
    case 0x5:
    {
      //ASCII String
      var length = objInfo;
      var stroffset = 1;
      if (objInfo == 0xF) {
        var int_type = buffer[offset + 1];
        var intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("0x5: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        var intInfo = int_type & 0x0F;
        var intLength = Math.pow(2, intInfo);
        stroffset = 2 + intLength;
        if (intLength < 3) {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        } else {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        }
      }
      if (length < exports.maxObjectSize) {
        return buffer.slice(offset + stroffset, offset + stroffset + length).toString('utf8');
      } else {
        throw new Error("To little heap space available! Wanted to read " + length + " bytes, but only " + exports.maxObjectSize + " are available.");
      }
    }
//    case 0x6: {
//      //UTF-16-BE String
//      int length = objInfo;
//      int stroffset = 1;
//      if (objInfo == 0xF) {
//        int int_type = bytes[offset + 1];
//        int intType = (int_type & 0xF0) / 0x10;
//        if (intType != 0x1) {
//          System.err.println("UNEXPECTED LENGTH-INT TYPE! " + intType);
//        }
//        int intInfo = int_type & 0x0F;
//        int intLength = (int) Math.pow(2, intInfo);
//        stroffset = 2 + intLength;
//        if (intLength < 3) {
//          length = (int) parseUnsignedInt(copyOfRange(bytes, offset + 2, offset + 2 + intLength));
//        } else {
//          length = new BigInteger(copyOfRange(bytes, offset + 2, offset + 2 + intLength)).intValue();
//        }
//      }
//      //length is String length -> to get byte length multiply by 2, as 1 character takes 2 bytes in UTF-16
//      length *= 2;
//      if (length < exports.maxObjectSize) {
//        return new NSString(copyOfRange(bytes, offset + stroffset, offset + stroffset + length), "UTF-16BE");
//      } else {
//        throw new Error("To little heap space available! Wanted to read " + length + " bytes, but only " + exports.maxObjectSize + " are available.");
//      }
//    }
//    case 0x8: {
//      //UID
//      int length = objInfo + 1;
//      if (length < exports.maxObjectSize) {
//        return new UID(String.valueOf(obj), copyOfRange(bytes, offset + 1, offset + 1 + length));
//      } else {
//        throw new Error("To little heap space available! Wanted to read " + length + " bytes, but only " + exports.maxObjectSize + " are available.");
//      }
//    }
    case 0xA:
    {
      //Array
      var length = objInfo;
      var arrayoffset = 1;
      if (objInfo == 0xF) {
        var int_type = buffer[offset + 1];
        var intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("0xa: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        var intInfo = int_type & 0x0F;
        var intLength = Math.pow(2, intInfo);
        arrayoffset = 2 + intLength;
        if (intLength < 3) {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        } else {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        }
      }
      if (length * objectRefSize > exports.maxObjectSize) {
        throw new Error("To little heap space available!");
      }
      var array = [];
      for (var i = 0; i < length; i++) {
        var objRef = readUInt(buffer.slice(offset + arrayoffset + i * objectRefSize, offset + arrayoffset + (i + 1) * objectRefSize));
        array[i] = parseObject(objRef);
      }
      return array;
    }
//    case 0xC: {
//      //Set
//      int length = objInfo;
//      int arrayoffset = 1;
//      if (objInfo == 0xF) {
//        int int_type = bytes[offset + 1];
//        int intType = (int_type & 0xF0) / 0x10;
//        if (intType != 0x1) {
//          System.err.println("UNEXPECTED LENGTH-INT TYPE! " + intType);
//        }
//        int intInfo = int_type & 0x0F;
//        int intLength = (int) Math.pow(2, intInfo);
//        arrayoffset = 2 + intLength;
//        if (intLength < 3) {
//          length = (int) parseUnsignedInt(copyOfRange(bytes, offset + 2, offset + 2 + intLength));
//        } else {
//          length = new BigInteger(copyOfRange(bytes, offset + 2, offset + 2 + intLength)).intValue();
//        }
//      }bytes
//      if (length * objectRefSize > exports.maxObjectSize) {
//        throw new Error("To little heap space available!");
//      }
//      NSSet set = new NSSet();
//      for (int i = 0; i < length; i++) {
//        int objRef = (int) parseUnsignedInt(copyOfRange(bytes,
//          offset + arrayoffset + i * objectRefSize,
//          offset + arrayoffset + (i + 1) * objectRefSize));
//        set.addObject(parseObject(objRef));
//      }
//      return set;
//    }
    case 0xD:
    {
      //Dictionary
      var length = objInfo;
      var dictoffset = 1;
      if (objInfo == 0xF) {
        var int_type = buffer[offset + 1];
        var intType = (int_type & 0xF0) / 0x10;
        if (intType != 0x1) {
          console.error("0xD: UNEXPECTED LENGTH-INT TYPE! " + intType);
        }
        var intInfo = int_type & 0x0F;
        var intLength = Math.pow(2, intInfo);
        dictoffset = 2 + intLength;
        if (intLength < 3) {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        } else {
          length = readUInt(buffer.slice(offset + 2, offset + 2 + intLength));
        }
      }
      if (length * 2 * objectRefSize > exports.maxObjectSize) {
        throw new Error("To little heap space available!");
      }
      if (debug) {
        console.log("Parsing dictionary #" + tableOffset);
      }
      var dict = {};
      for (var i = 0; i < length; i++) {
        var keyRef = readUInt(buffer.slice(offset + dictoffset + i * objectRefSize, offset + dictoffset + (i + 1) * objectRefSize));
        var valRef = readUInt(buffer.slice(offset + dictoffset + (length * objectRefSize) + i * objectRefSize, offset + dictoffset + (length * objectRefSize) + (i + 1) * objectRefSize));
        var key = parseObject(keyRef);
        var val = parseObject(valRef);
        if (debug) {
          console.log("  DICT #" + tableOffset + ": Mapped " + key + " to " + val);
        }
        dict[key] = val;
      }
      return dict;
    }
    default:
      throw new Error("Unhandled type 0x" + objType.toString(16));
    }
    return null;
  }

  return [ parseObject(topObject) ];
};

function readUInt(buffer, start) {
  start = start || 0;

  var l = 0;
  for (var i = start; i < buffer.length; i++) {
    l <<= 8;
    l |= buffer[i] & 0xFF;
  }
  return l;
}

// we're just going to toss the high order bits because javascript doesn't have 64-bit ints
function readUInt64BE(buffer, start) {
  var data = buffer.slice(start, start + 8);
  return data.readUInt32BE(4, 8);
}