var assert = require('assert');
var Tree = require('./utils/builder');
var watch = require('../lib/watch');
var is = require('../lib/is');
var hasNativeRecursive = require('../lib/has-native-recursive');

var tree = Tree();
var watcher;

beforeEach(function() {
  tree = Tree();
});

afterEach(function(done) {
  if (watcher && !watcher.isClosed()) {
    watcher.on('close', done);
    watcher.close();
  } else {
    done();
  }
});

after(function() {
  if (tree) {
    tree.cleanup();
  }
});

function wait(fn, timeout) {
  try {
    fn();
  } catch (error) {
    timeout -= 30;
    if (timeout >= 0) {
      setTimeout(function() {
        wait(fn, timeout);
      }, 30);
    } else {
      throw error;
    }
  }
}

describe('process events', function() {
  it('should emit `close` event', function(done) {
    var file = 'home/a/file1';
    var fpath = tree.getPath(file);
    watcher = watch(fpath, function() {});
    watcher.on('close', function() {
      done();
    });
    watcher.close();
  });

  it('should emit `ready` event when watching a file', function(done) {
    var file = 'home/a/file1';
    var fpath = tree.getPath(file);
    watcher = watch(fpath);
    watcher.on('ready', function() {
      done();
    });
  });

  it('should emit `ready` event when watching a directory recursively', function(done) {
    var dir = tree.getPath('home');
    watcher = watch(dir, { recursive: true });
    watcher.on('ready', function() {
      done();
    });
  });

  it('should emit `ready` properly in a composed watcher', function(done) {
    var dir1 = tree.getPath('home/a');
    var dir2 = tree.getPath('home/b');
    var file = tree.getPath('home/b/file1');
    watcher = watch([dir1, dir2, file], { recursive: true });
    watcher.on('ready', function() {
      done();
    });
  });
});

describe('watch for files', function() {
  it('should watch a single file and keep watching', function(done) {
    var times = 1;
    var file = 'home/a/file1';
    var fpath = tree.getPath(file);
    watcher = watch(fpath, { delay: 0 }, function(evt, name) {
      assert.equal(fpath, name)
      if (times++ >= 3) {
        done();
      }
    });
    watcher.on('ready', function() {
      tree.modify(file);
      tree.modify(file, 100);
      tree.modify(file, 200);
    });
  });

  it('should watch files inside a directory', function(done) {
    var fpath = tree.getPath('home/a');
    var stack = [
      tree.getPath('home/a/file1'),
      tree.getPath('home/a/file2')
    ];
    watcher = watch(fpath, { delay: 0 }, function(evt, name) {
      stack.splice(stack.indexOf(name), 1);
      if (!stack.length) done();
    });

    watcher.on('ready', function() {
      tree.modify('home/a/file1');
      tree.modify('home/a/file2', 100);
    });
  });

  it('should ignore duplicate changes', function(done) {
    var file = 'home/a/file2';
    var fpath = tree.getPath(file);
    var times = 0;
    watcher = watch(fpath, { delay: 200 }, function(evt, name) {
      if (fpath === name) times++;
    });
    watcher.on('ready', function() {
      tree.modify(file);
      tree.modify(file, 100);
      tree.modify(file, 150);

      wait(function() {
        assert.equal(times, 1)
        done();
      }, 250);
    });
  });

  it('should listen to new created files', function(done) {
    var home = tree.getPath('home');
    var newfile1 = 'home/a/newfile' + Math.random();
    var newfile2 = 'home/a/newfile' + Math.random();
    var changes = [];
    watcher = watch(home, { delay: 0, recursive: true }, function(evt, name) {
      changes.push(name);
    });
    watcher.on('ready', function() {
      tree.newFile(newfile1);
      tree.newFile(newfile2);
      wait(function() {
        // On windows it will report its parent directory along with the filename
        // https://github.com/yuanchuan/node-watch/issues/79
        if (is.windows()) {
          // Make sure new files are deteced
          assert.ok(
            changes.includes(tree.getPath(newfile1)) &&
            changes.includes(tree.getPath(newfile2))
          );
          // It should only include new files and its parent directory
          // if there are more than 2 events
          if (changes.length > 2) {
            let accepts = [
              tree.getPath(newfile1),
              tree.getPath(newfile2),
              tree.getPath('home/a')
            ];
            changes.forEach(function(name) {
              assert.ok(accepts.includes(name), name + " should not be included");
            });
          }
        } else {
          assert.deepStrictEqual(
            changes,
            [tree.getPath(newfile1), tree.getPath(newfile2)]
          );
        }
        done();
      }, 100);
    });
  });
});

describe('watch for directories', function() {
  it('should watch directories inside a directory', function(done) {
    var home = tree.getPath('home');
    var dir = tree.getPath('home/c');
    var events = [];

    watcher = watch(home, { delay: 0, recursive: true }, function(evt, name) {
      if (name === dir) {
        events.push(evt);
      }
    });
    watcher.on('ready', function() {
      tree.remove('home/c');

      wait(function () {
        assert.deepStrictEqual(
          events,
          [ 'remove' ]
        );
        done();
      }, 400);
    });
  });

  it('should watch new created directories', function(done) {
    var home = tree.getPath('home');
    watcher = watch(home, { delay: 0, recursive: true }, function(evt, name) {
      if (name === tree.getPath('home/new/file1')) {
        done();
      }
    });
    watcher.on('ready', function() {
      // newFile() will create the 'new/' directory and the 'new/file1' file,
      // but, only the creation of the directory is observed.
      // Because of that, there will only be one event for file1, when it
      // is modified, not when it is created.
      tree.newFile('home/new/file1');
      tree.modify('home/new/file1', 100);
    });
  });

  it('should not watch new created directories which are being skipped in the filter', function(done) {
    var home = tree.getPath('home');
    var options = {
      delay: 0,
      recursive: true,
      filter: function(filePath, skip) {
        if (/ignored/.test(filePath)) return skip;
        return true;
      }
    }

    watcher = watch(home, options, function(evt, name) {
      assert.fail("event detect", name);
    });

    watcher.on('ready', function() {
      tree.newFile('home/ignored/file');
      tree.modify('home/ignored/file', 100);
      wait(done, 150);
    });
  });

  it('should keep watching after removal of sub directory', function(done) {
    var home = tree.getPath('home');
    var file1 = tree.getPath('home/e/file1');
    var file2 = tree.getPath('home/e/file2');
    var dir = tree.getPath('home/e/sub');
    var events = [];
    watcher = watch(home, { delay: 0, recursive: true }, function(evt, name) {
      if (name === dir || name === file1 || name === file2) {
        events.push(name);
      }
    });
    watcher.on('ready', function() {
      tree.remove('home/e/sub', 50);
      tree.modify('home/e/file1', 100);
      tree.modify('home/e/file2', 200);

      wait(function() {
        assert.deepStrictEqual(events, [dir, file1, file2]);
        done();
      }, 300);
    });
  });

  it('should watch new directories without delay', function(done) {
    var home = tree.getPath('home');
    var events = [];
    watcher = watch(home, { delay: 200, recursive: true }, function(evt, name) {
      if (name === tree.getPath('home/new/file1')) {
        events.push(evt);
      }
    });
    watcher.on('ready', function() {
      tree.newFile('home/new/file1');
      tree.modify('home/new/file1', 50);
      tree.modify('home/new/file1', 100);
      wait(function() {
        assert.deepStrictEqual(events, ['update']);
        done();
      }, 350);
    });
  });
});

describe('file events', function() {
  it('should identify `remove` event', function(done) {
    var file = 'home/a/file1';
    var fpath = tree.getPath(file);
    watcher = watch(fpath, function(evt, name) {
      if (evt === 'remove' && name === fpath) done();
    });
    watcher.on('ready', function() {
      tree.remove(file);
    });
  });

  it('should identify `remove` event on directory', function(done) {
    var dir = 'home/a';
    var home = tree.getPath('home');
    var fpath = tree.getPath(dir);
    watcher = watch(home, function(evt, name) {
      if (evt === 'remove' && name === fpath) done();
    });
    watcher.on('ready', function() {
      tree.remove(dir);
    });
  });

  it('should be able to handle many events on deleting', function(done) {
    var dir = 'home/a';
    var fpath = tree.getPath(dir);
    var names = tree.newRandomFiles(dir, 300);

    var count = 0;
    watcher = watch(fpath, function(evt, name) {
      count += 1;
      if (count == names.length) done();
    });

    watcher.on('ready', function() {
      names.forEach(tree.remove.bind(tree));
    });
  });

  it('should identify `update` event', function(done) {
    var file = 'home/a/file1';
    var fpath = tree.getPath(file);
    watcher = watch(fpath, function(evt, name) {
      if (evt === 'update' && name === fpath) done();
    });
    watcher.on('ready', function() {
      tree.modify(file);
    });
  });

  it('should report `update` on new files', function(done) {
    var dir = tree.getPath('home/a');
    var file = 'home/a/newfile' + Date.now();
    var fpath = tree.getPath(file);
    watcher = watch(dir, function(evt, name) {
      if (evt === 'update' && name === fpath) done();
    });
    watcher.on('ready', function() {
      tree.newFile(file);
    });
  });
});

describe('options', function() {
  describe('recursive', function() {
    it('should watch recursively with `recursive: true` option', function(done) {
      var dir = tree.getPath('home');
      var file = tree.getPath('home/bb/file1');
      watcher = watch(dir, { recursive: true }, function(evt, name) {
        if (file === name) {
          done();
        }
      });
      watcher.on('ready', function() {
        tree.modify('home/bb/file1');
      });
    });
  });

  describe('encoding', function() {
    it('should throw on invalid encoding', function(done) {
      var dir = tree.getPath('home/a');
      try {
        watcher = watch(dir, 'unknown');
      } catch (e) {
        done();
      }
    });

    it('should accept options as an encoding string', function(done) {
      var dir = tree.getPath('home/a');
      var file = 'home/a/file1';
      var fpath = tree.getPath(file);
      watcher = watch(dir, 'utf8', function(evt, name) {
        assert.equal(name.toString(), fpath);
        done();
      });
      watcher.on('ready', function() {
        tree.modify(file);
      });
    });

    it('should support buffer encoding', function(done) {
      var dir = tree.getPath('home/a');
      var file = 'home/a/file1';
      var fpath = tree.getPath(file);
      watcher = watch(dir, 'buffer', function(evt, name) {
        assert(Buffer.isBuffer(name), 'not a Buffer')
        assert.equal(name.toString(), fpath);
        done();
      });
      watcher.on('ready', function() {
        tree.modify(file);
      });
    });

    it('should support base64 encoding', function(done) {
      var dir = tree.getPath('home/a');
      var file = 'home/a/file1';
      var fpath = tree.getPath(file);
      watcher = watch(dir, 'base64', function(evt, name) {
        assert.equal(
          name,
          Buffer.from(fpath).toString('base64'),
          'wrong base64 encoding'
        );
        done();
      });
      watcher.on('ready', function() {
        tree.modify(file);
      });
    });

    it('should support hex encoding', function(done) {
      var dir = tree.getPath('home/a');
      var file = 'home/a/file1';
      var fpath = tree.getPath(file);
      watcher = watch(dir, 'hex', function(evt, name) {
        assert.equal(
          name,
          Buffer.from(fpath).toString('hex'),
          'wrong hex encoding'
        );
        done();
      });
      watcher.on('ready', function() {
        tree.modify(file);
      });
    });
  });

  describe('filter', function() {
    it('should only watch filtered directories', function(done) {
      var matchRegularDir = false;
      var matchIgnoredDir = false;

      var options = {
        delay: 0,
        recursive: true,
        filter: function(name) {
          return !/deep_node_modules/.test(name);
        }
      };

      watcher = watch(tree.getPath('home'), options, function(evt, name) {
        if (/deep_node_modules/.test(name)) {
          matchIgnoredDir = true;
        } else {
          matchRegularDir = true;
        }
      });
      watcher.on('ready', function() {
        tree.modify('home/b/file1');
        tree.modify('home/deep_node_modules/ma/file1');

        wait(function() {
          assert(matchRegularDir, 'watch failed to detect regular file');
          assert(!matchIgnoredDir, 'fail to ignore path `deep_node_modules`');
          done();
        }, 100);
      });
    });

    it('should only report filtered files', function(done) {
      var dir = tree.getPath('home');
      var file1 = 'home/bb/file1';
      var file2 = 'home/bb/file2';

      var options = {
        delay: 0,
        recursive: true,
        filter: function(name) {
          return /file2/.test(name);
        }
      }

      var times = 0;
      var matchIgnoredFile = false;
      watcher = watch(dir, options, function(evt, name) {
        times++;
        if (name === tree.getPath(file1)) {
          matchIgnoredFile = true;
        }
      });
      watcher.on('ready', function() {
        tree.modify(file1);
        tree.modify(file2, 50);

        wait(function() {
          assert.equal(times, 1, 'should only report /home/bb/file2 once');
          assert.equal(matchIgnoredFile, false, 'home/bb/file1 should be ignored');
          done();
        }, 100);
      });
    });

    it('should be able to filter with regexp', function(done) {
      var dir = tree.getPath('home');
      var file1 = 'home/bb/file1';
      var file2 = 'home/bb/file2';

      var options = {
        delay: 0,
        recursive: true,
        filter:  /file2/
      }

      var times = 0;
      var matchIgnoredFile = false;
      watcher = watch(dir, options, function(evt, name) {
        times++;
        if (name === tree.getPath(file1)) {
          matchIgnoredFile = true;
        }
      });
      watcher.on('ready', function() {
        tree.modify(file1);
        tree.modify(file2, 50);

        wait(function() {
          assert(times, 1, 'report file2');
          assert(!matchIgnoredFile, 'home/bb/file1 should be ignored');
          done();
        }, 100);
      });
    });

    it('should be able to skip subdirectories with `skip` flag', function(done) {
      var home = tree.getPath('home');
      var options = {
        delay: 0,
        recursive: true,
        filter: function(name, skip) {
          if (/\/deep_node_modules/.test(name)) return skip;
        }
      };
      watcher = watch(home, options);

      watcher.getWatchedPaths(function(paths) {
        hasNativeRecursive(function(supportRecursive) {
          var watched = supportRecursive
              // The skip flag has no effect to the platforms which support recursive option,
              // so the home directory is the only one that's in the watching list.
            ? [home]
              // The deep_node_modules and all its subdirectories should not be watched
              // with skip flag specified in the filter.
            : tree.getAllDirectories().filter(function(name) {
                return !/\/deep_node_modules/.test(name);
              });

          assert.deepStrictEqual(
            watched.sort(), paths.sort()
          );

          done();
        });
      });
    });
  });

  describe('delay', function() {
    it('should have delayed response', function(done) {
      var dir = tree.getPath('home/a');
      var file = 'home/a/file1';
      var start;
      watcher = watch(dir, { delay: 300 }, function(evt, name) {
        assert(Date.now() - start >= 300, 'delay not working');
        done();
      });
      watcher.on('ready', function() {
        start = Date.now();
        tree.modify(file);
      });
    });
  });
});

describe('parameters', function() {
  it('should throw error on non-existed file', function(done) {
    var somedir = tree.getPath('home/somedir');
    watcher = watch(somedir);
    watcher.on('error', function(err) {
      if (err.message.includes('does not exist')) {
        done()
      }
    })
  });

  it('should accept filename as Buffer', function(done) {
    var fpath = tree.getPath('home/a/file1');
    watcher = watch(Buffer.from(fpath), { delay: 0 }, function(evt, name) {
      assert.equal(name, fpath);
      done();
    });
    watcher.on('ready', function() {
      tree.modify('home/a/file1');
    });
  });

  it('should compose array of files or directories', function(done) {
    var file1 = 'home/a/file1';
    var file2 = 'home/a/file2';
    var fpaths = [
      tree.getPath(file1),
      tree.getPath(file2)
    ];

    var times = 0;
    watcher = watch(fpaths, { delay: 0 }, function(evt, name) {
      if (fpaths.indexOf(name) !== -1) times++;
      if (times === 2) done();  // calling done more than twice causes mocha test to fail
    });

    watcher.on('ready', function() {
      tree.modify(file1);
      tree.modify(file2, 50);
    });
  });

  it('should filter duplicate events for composed watcher', function(done) {
    var home = 'home';
    var dir = 'home/a';
    var file1 = 'home/a/file1';
    var file2 = 'home/a/file2';
    var fpaths = [
      tree.getPath(home),
      tree.getPath(dir),
      tree.getPath(file1),
      tree.getPath(file2)
    ];

    var changes = [];
    watcher = watch(fpaths, { delay: 100, recursive: true }, function(evt, name) {
      changes.push(name);
    });

    watcher.on('ready', function() {
      tree.modify(file1);
      tree.modify(file2, 50);

      wait(function() {
        assert.deepStrictEqual(
          changes,
          [tree.getPath(file1), tree.getPath(file2)]
        );
        done();
      }, 200);
    });
  });
});

describe('watcher object', function() {
  it('should using watcher object to watch', function(done) {
    var dir = tree.getPath('home/a');
    var file = 'home/a/file1';
    var fpath = tree.getPath(file);

    watcher = watch(dir, { delay: 0 });
    watcher.on('ready', function() {
      watcher.on('change', function(evt, name) {
        assert.equal(evt, 'update');
        assert.equal(name, fpath);
        done();
      });
      tree.modify(file);
    });
  });

  describe('close()', function() {
    it('should close a watcher using .close()', function(done) {
      var dir = tree.getPath('home/a');
      var file = 'home/a/file1';
      var times = 0;
      watcher = watch(dir, { delay: 0 });
      watcher.on('change', function(evt, name) {
        times++;
      });
      watcher.on('ready', function() {

        watcher.close();

        tree.modify(file);
        tree.modify(file, 100);

        wait(function() {
          assert(watcher.isClosed(), 'watcher should be closed');
          assert.equal(times, 0, 'failed to close the watcher');
          done();
        }, 150);
      });
    });

    it('should not watch after .close() is called', function(done) {
      var dir = tree.getPath('home');
      watcher = watch(dir, { delay: 0, recursive: true });
      watcher.close();

      watcher.getWatchedPaths(function(dirs) {
        assert(dirs.length === 0);
        done();
      });
    });

    it('Do not emit after close', function(done) {
      var dir = tree.getPath('home/a');
      var file = 'home/a/file1';
      var times = 0;
      watcher = watch(dir, { delay: 0 });
      watcher.on('change', function(evt, name) {
        times++;
      });
      watcher.on('ready', function() {

        watcher.close();

        var timer = setInterval(function() {
          tree.modify(file);
        });

        wait(function() {
          clearInterval(timer);
          assert(watcher.isClosed(), 'watcher should be closed');
          assert.equal(times, 0, 'failed to close the watcher');
          done();
        }, 100);
      });
    });

  });

  describe('getWatchedPaths()', function() {
    it('should get all the watched paths', function(done) {
      var home = tree.getPath('home');
      watcher = watch(home, {
        delay: 0,
        recursive: true
      });
      watcher.getWatchedPaths(function(paths) {
        hasNativeRecursive(function(supportRecursive) {
          var watched = supportRecursive
              // The home directory is the only one that's being watched
              // if the recursive option is natively supported.
            ? [home]
              // Otherwise it should include all its subdirectories.
            : tree.getAllDirectories();

          assert.deepStrictEqual(
            watched.sort(), paths.sort()
          );

          done();
        });
      });
    });

    it('should get its parent path instead of the file itself', function(done) {
      var file = tree.getPath('home/a/file1');
      // The parent path is actually being watched instead.
      var parent = tree.getPath('home/a');

      watcher = watch(file, { delay: 0 });

      watcher.getWatchedPaths(function(paths) {
        assert.deepStrictEqual([parent], paths);
        done();
      });
    });

    it('should work correctly with composed watcher', function(done) {
      var a = tree.getPath('home/a');

      var b = tree.getPath('home/b');
      var file = tree.getPath('home/b/file1');

      var nested = tree.getPath('home/deep_node_modules');
      var ma = tree.getPath('home/deep_node_modules/ma');
      var mb = tree.getPath('home/deep_node_modules/mb');
      var mc = tree.getPath('home/deep_node_modules/mc');

      watcher = watch([a, file, nested], {
        delay: 0,
        recursive: true
      });

      watcher.getWatchedPaths(function(paths) {
        hasNativeRecursive(function(supportRecursive) {
          var watched = supportRecursive
            ? [a, b, nested]
            : [a, b, nested, ma, mb, mc];

          assert.deepStrictEqual(
            watched.sort(), paths.sort()
          );

          done();
        });
      });
    });
  });
});
