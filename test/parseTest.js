'use strict';

// tests are adapted from https://github.com/TooTallNate/node-plist

var path = require('path');
var nodeunit = require('nodeunit');
var bplist = require('../');

module.exports = {
  'iTunes Small': function (test) {
    var file = path.join(__dirname, "iTunes-small.bplist");
    var startTime1 = new Date();

    bplist.parseFile(file, function (err, dicts) {
      if (err) {
        throw err;
      }

      var endTime = new Date();
      console.log('Parsed "' + file + '" in ' + (endTime - startTime1) + 'ms');
      var dict = dicts[0];
      test.equal(dict['Application Version'], "9.0.3");
      test.equal(dict['Library Persistent ID'], "6F81D37F95101437");
      test.done();
    });
  },

  'sample1': function (test) {
    var file = path.join(__dirname, "sample1.bplist");
    var startTime = new Date();

    bplist.parseFile(file, function (err, dicts) {
      if (err) {
        throw err;
      }

      var endTime = new Date();
      console.log('Parsed "' + file + '" in ' + (endTime - startTime) + 'ms');
      var dict = dicts[0];
      test.equal(dict['CFBundleIdentifier'], 'com.apple.dictionary.MySample');
      test.done();
    });
  },

  'sample2': function (test) {
    var file = path.join(__dirname, "sample2.bplist");
    var startTime = new Date();

    bplist.parseFile(file, function (err, dicts) {
      if (err) {
        throw err;
      }

      var endTime = new Date();
      console.log('Parsed "' + file + '" in ' + (endTime - startTime) + 'ms');
      var dict = dicts[0];
      test.equal(dict['PopupMenu'][2]['Key'], "\n        #import <Cocoa/Cocoa.h>\n\n#import <MacRuby/MacRuby.h>\n\nint main(int argc, char *argv[])\n{\n  return macruby_main(\"rb_main.rb\", argc, argv);\n}\n");
      test.done();
    });
  },

  'airplay': function (test) {
    var file = path.join(__dirname, "airplay.bplist");
    var startTime = new Date();

    bplist.parseFile(file, function (err, dicts) {
      if (err) {
        throw err;
      }

      var endTime = new Date();
      console.log('Parsed "' + file + '" in ' + (endTime - startTime) + 'ms');

      var dict = dicts[0];
      test.equal(dict['duration'], 5555.0495000000001);
      test.equal(dict['position'], 4.6269989039999997);
      test.done();
    });
  }
};