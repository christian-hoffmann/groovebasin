var uuid = require('./uuid');
var curlydiff = require('curlydiff');
var Player = require('./player');
var Pend = require('pend');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var keese = require('keese');
var dbIterate = require('./db_iterate');
var log = require('./log');

var USERS_KEY_PREFIX = "Users.";
var EVENTS_KEY_PREFIX = "Events.";
var GUEST_USER_ID = "(guest)"; // uses characters not in the uuid() character set

var MAX_EVENT_COUNT = 400;
var MAX_NAME_LEN = 64;
var MAX_PASSWORD_LEN = 1024;
var UUID_LEN = uuid().length;

module.exports = PlayerServer;

PlayerServer.plugins = [];

PlayerServer.actions = {
  'approve': {
    permission: 'admin',
    args: 'array',
    fn: function(self, client, approvals) {
      self.processApprovals(approvals);
    },
  },
  'clear': {
    permission: 'control',
    fn: function(self) {
      self.player.clearQueue();
    },
  },
  'chat': {
    permission: 'control',
    args: 'string',
    fn: function(self, client, text) {
      self.addEvent(client.user, 'chat', text);
    },
  },
  'deleteTracks': {
    permission: 'admin',
    args: 'array',
    fn: function(self, client, keys) {
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i];
        self.player.deleteFile(key);
      }
    },
  },
  'deleteUsers': {
    permission: 'admin',
    args: 'array',
    fn: function(self, client, ids) {
      self.deleteUsers(ids);
    },
  },
  'dynamicModeOn': {
    permission: 'control',
    args: 'boolean',
    fn: function(self, client, on) {
      self.player.setDynamicModeOn(on);
    },
  },
  'dynamicModeHistorySize': {
    permission: 'control',
    args: 'number',
    fn: function(self, client, size) {
      self.player.setDynamicModeHistorySize(size);
    },
  },
  'dynamicModeFutureSize': {
    permission: 'control',
    args: 'number',
    fn: function(self, client, size) {
      self.player.setDynamicModeFutureSize(size);
    },
  },
  'ensureAdminUser': {
    permission: null,
    fn: function(self) {
      self.ensureAdminUser();
    },
  },
  'hardwarePlayback': {
    permission: 'admin',
    args: 'boolean',
    fn: function(self, client, isOn) {
      //self.player.setHardwarePlayback(isOn);
    },
  },
  'importUrl': {
    permission: 'control',
    args: 'object',
    fn: function(self, client, args) {
      var urlString = args.url;
      var id = args.id;
      var autoQueue = args.autoQueue;
      if (!self.validateString(client, urlString)) return;
      if (!self.validateString(client, id, UUID_LEN)) return;
      if (!self.validateBoolean(client, autoQueue)) return;
      self.player.importUrl(urlString, function(err, dbFiles) {
        if (err) {
          log.error("Unable to import url:", urlString, err.stack);
        } else if (!dbFiles) {
          log.warn("Unable to import url, unrecognized format");
        } else if (dbFiles.length > 0) {
          self.addEvent(client.user, 'import', null, dbFiles[0].key, dbFiles.length);
          if (autoQueue) {
            self.player.sortAndQueueTracks(dbFiles);
            self.addEvent(client.user, 'queue', null, dbFiles[0].key, dbFiles.length);
          }
        }
      });
    },
  },
  'login': {
    permission: null,
    args: 'object',
    fn: function(self, client, args) {
      if (!self.validateString(client, args.username, MAX_NAME_LEN)) return;
      if (!self.validateString(client, args.password, MAX_PASSWORD_LEN)) return;
      self.login(client, args.username, args.password);
      self.sendUserMessage(client);
    },
  },
  'logout': {
    permission: null,
    fn: function(self, client) {
      self.logout(client);
    },
  },
  'subscribe': {
    permission: 'read',
    args: 'object',
    fn: function(self, client, args) {
      var errText;
      var name = args.name;
      var subscription = self.subscriptions[name];
      if (!subscription) {
        errText = "Invalid subscription item: " + JSON.stringify(name);
        log.warn(errText);
        client.sendMessage("error", errText);
        return;
      }
      if (!client.userHasPerm(subscription.perm)) {
        errText = "subscribing to " + JSON.stringify(name) +
          " requires permission " + JSON.stringify(subscription.perm);
        log.warn(errText);
        client.sendMessage("error", errText);
        return;
      }
      if (args.delta && client.subscriptions[name] !== 'delta') {
        client.subscriptions[name] = 'delta';
        if (args.version !== subscription.version) {
          client.sendMessage(name, {
            version: subscription.version,
            reset: true,
            delta: curlydiff.diff(undefined, subscription.value),
          });
        }
      } else if (client.subscriptions[name] !== 'simple') {
        client.subscriptions[name] = 'simple';
        client.sendMessage(name, subscription.value);
      }
    },
  },
  'updateTags': {
    permission: 'admin',
    args: 'object',
    fn: function(self, client, obj) {
      self.player.updateTags(obj);
    },
  },
  'updateUser': {
    permission: 'admin',
    args: 'object',
    fn: function(self, client, args) {
      if (!self.validateString(client, args.userId, UUID_LEN)) return;
      self.updateUser(client, args.userId, args.perms);
    },
  },
  'unsubscribe': {
    permission: 'read',
    args: 'string',
    fn: function(self, client, name) {
      self.unsubscribe(client, name);
    },
  },
  'move': {
    permission: 'control',
    args: 'object',
    fn: function(self, client, items) {
      self.player.moveQueueItems(items);
      self.addEvent(client.user, 'move', null, null, null, true);
    },
  },
  'pause': {
    permission: 'control',
    fn: function(self, client) {
      self.addEvent(client.user, 'pause');
      self.player.pause();
    },
  },
  'play': {
    permission: 'control',
    fn: function(self, client) {
      self.addEvent(client.user, 'play');
      self.player.play();
    },
  },
  'queue': {
    permission: 'add',
    args: 'object',
    fn: function(self, client, items) {
      var id, item;
      var trackCount = 0;
      var trackKey = null;
      for (id in items) {
        item = items[id];
        if (!self.validateObject(client, item)) return;
        trackCount += 1;
        trackKey = trackKey || item.key;
      }

      if (trackCount !== 1) {
        trackKey = null;
      }
      self.addEvent(client.user, 'queue', null, trackKey, trackCount);
      self.player.addItems(items);
    },
  },
  'seek': {
    permission: 'control',
    args: 'object',
    fn: function(self, client, args) {
      var id = args.id;
      var pos = parseFloat(args.pos);

      if (!self.validateString(client, id, UUID_LEN)) return;
      if (!self.validateFloat(client, pos)) return;

      var track = self.player.playlist[id];
      if (track) {
        self.addEvent(client.user, 'seek', null, track.key, pos);
      }

      self.player.seek(id, pos);
    },
  },
  'setStreaming': {
    args: 'boolean',
    fn: function(self, client, streamOn) {
      if (client.streaming === streamOn) return;
      client.streaming = streamOn;
      if (streamOn) {
        self.emit('streamStart', client);
      } else {
        self.emit('streamStop', client);
      }
    },
  },
  'remove': {
    permission: 'control',
    args: 'array',
    fn: function(self, client, ids) {
      var item = (ids.length === 1) && self.player.playlist[ids[0]];
      var key = item && item.key;
      self.addEvent(client.user, 'remove', null, key, ids.length);
      self.player.removeQueueItems(ids);
    },
  },
  'repeat': {
    permission: 'control',
    args: 'number',
    fn: function(self, client, mode) {
      self.player.setRepeat(mode);
    },
  },
  'requestApproval': {
    permission: null,
    fn: function(self, client) {
      self.requestApproval(client);
      self.sendUserMessage(client);
    },
  },
  'setvol': {
    permission: 'control',
    args: 'number',
    fn: function(self, client, vol) {
      self.player.setVolume(vol);
    },
  },
  'shuffle': {
    permission: 'control',
    fn: function(self, client) {
      self.player.shufflePlaylist();
    },
  },
  'stop': {
    permission: 'control',
    fn: function(self, client) {
      self.player.stop();
      self.addEvent(client.user, 'stop');
    },
  },
  'playlistCreate': {
    permission: 'control',
    args: 'object',
    fn: function(self, client, args) {
      self.player.playlistCreate(args.id, args.name);
    },
  },
  'playlistRename': {
    permission: 'control',
    args: 'object',
    fn: function(self, client, args) {
      self.player.playlistRename(args.id, args.name);
    },
  },
  'playlistDelete': {
    permission: 'control',
    args: 'array',
    fn: function(self, client, ids) {
      self.player.playlistDelete(ids);
    },
  },
  'playlistAddItems': {
    permission: 'control',
    args: 'object',
    fn: function(self, client, args) {
      self.player.playlistAddItems(args.id, args.items);
    },
  },
  'playlistRemoveItems': {
    permission: 'control',
    args: 'object',
    fn: function(self, client, args) {
      self.player.playlistRemoveItems(args.id, args.items);
    },
  },
  'playlistMoveItems': {
    permission: 'control',
    args: 'object',
    fn: function(self, client, args) {
      self.player.playlistMoveItems(args.id, args.items);
    },
  },
};

util.inherits(PlayerServer, EventEmitter);
function PlayerServer(options) {
  EventEmitter.call(this);

  this.player = options.player;
  this.db = options.db;
  this.subscriptions = {};
  this.users = {};
  this.addGuestUser();
  this.usernameIndex = null; // username -> user
  this.oneLineAuth = null; // username/password -> perms
  this.computeUsersIndex();

  this.clients = {};

  this.events = {};
  this.eventsInOrder = [];


  this.playlistId = uuid();
  this.libraryId = uuid();
  this.initialize();
}

PlayerServer.prototype.ensureGuestUser = function() {
  this.guestUser = this.users[GUEST_USER_ID];
  if (!this.guestUser) {
    this.addGuestUser();
  }
};

PlayerServer.prototype.addGuestUser = function() {
  // default guest user. overridden by db if present
  this.guestUser = {
    id: GUEST_USER_ID,
    name: 'Guest',
    password: "",
    registered: true,
    requested: true,
    approved: true,
    perms: {
      read: true,
      add: true,
      control: true,
      admin: false,
    },
  };
  this.users[this.guestUser.id] = this.guestUser;
};

PlayerServer.prototype.haveAdminUser = function() {
  for (var id in this.users) {
    var user = this.users[id];
    if (user.perms.admin) {
      return true;
    }
  }
  return false;
};

PlayerServer.prototype.ensureAdminUser = function() {
  if (this.haveAdminUser()) {
    return;
  }

  var user = true;
  var name;
  while (user) {
    name = "Admin-" + uuid.len(6);
    user = this.usernameIndex[name];
  }

  var adminUser = {
    id: uuid(),
    name: name,
    password: uuid(),
    registered: true,
    requested: true,
    approved: true,
    perms: {
      read: true,
      add: true,
      control: true,
      admin: true,
    },
  };
  this.users[adminUser.id] = adminUser;
  this.saveUser(adminUser);

  log.info("No admin account found. Created one:");
  log.info("Username: " + adminUser.name);
  log.info("Password: " + adminUser.password);

  this.emit("haveAdminUser");
  this.emit("users");
};

PlayerServer.prototype.initialize = function() {
  var self = this;
  self.player.on('currentTrack', addSubscription('currentTrack', getCurrentTrack));
  self.player.on('dynamicModeOn', addSubscription('dynamicModeOn', getDynamicModeOn));
  self.player.on('dynamicModeHistorySize', addSubscription('dynamicModeHistorySize', getDynamicModeHistorySize));
  self.player.on('dynamicModeFutureSize', addSubscription('dynamicModeFutureSize', getDynamicModeFutureSize));
  self.player.on('repeatUpdate', addSubscription('repeat', getRepeat));
  self.player.on('volumeUpdate', addSubscription('volume', getVolume));
  self.player.on('queueUpdate', addSubscription('queue', serializeQueue));
  self.player.on('hardwarePlayback', addSubscription('hardwarePlayback', getHardwarePlayback));

  var onLibraryUpdate = addSubscription('library', serializeLibrary);
  self.player.on('addDbTrack', onLibraryUpdate);
  self.player.on('updateDbTrack', onLibraryUpdate);
  self.player.on('deleteDbTrack', onLibraryUpdate);
  self.player.on('scanComplete', onLibraryUpdate);


  self.player.on('scanProgress', addSubscription('scanning', serializeScanState));

  var onPlaylistUpdate = addSubscription('playlists', serializePlaylists);
  self.player.on('playlistCreate', onPlaylistUpdate);
  self.player.on('playlistUpdate', onPlaylistUpdate);
  self.player.on('playlistDelete', onPlaylistUpdate);

  self.player.on('seek', function() {
    self.forEachClient(function(client) {
      client.sendMessage('seek');
    });
  });

  var onImportProgress = addSubscription('importProgress', serializeImportProgress);
  self.player.on('importStart', onImportProgress);
  self.player.on('importEnd', onImportProgress);
  self.player.on('importAbort', onImportProgress);
  self.player.on('importProgress', onImportProgress);

  // this is only anonymous streamers
  var onStreamersUpdate = addSubscription('streamers', serializeStreamers);
  self.player.on('streamerConnect', onStreamersUpdate);
  self.player.on('streamerDisconnect', onStreamersUpdate);

  setInterval(function() {
    self.forEachClient(function(client) {
      client.sendMessage('time', new Date());
    });
  }, 30000);

  self.on('haveAdminUser', addSubscription('haveAdminUser', getHaveAdminUser));
  self.on('events', addSubscription('events', getEvents));

  var onUsersUpdate = addSubscription('users', getUsers);
  self.on('users', onUsersUpdate);
  self.on('streamStart', onUsersUpdate);
  self.on('streamStop', onUsersUpdate);

  // events
  self.player.on('currentTrack', addCurrentTrackEvent);
  self.on('streamStart', addStreamerConnectEvent);
  self.on('streamStop', addStreamerDisconnectEvent);
  self.player.on('streamerConnect', maybeAddAnonStreamerConnectEvent);
  self.player.on('streamerDisconnect', maybeAddAnonStreamerDisconnectEvent);

  self.player.on('streamerDisconnect', self.checkLastStreamerDisconnected.bind(self));
  self.on('streamStop', self.checkLastStreamerDisconnected.bind(self));

  self.player.on('autoPause', addAutoPauseEvent);

  var prevCurrentTrackKey = null;
  function addCurrentTrackEvent() {
    var currentTrackKey = self.player.currentTrack ? self.player.currentTrack.key : null;
    if (currentTrackKey !== prevCurrentTrackKey) {
      prevCurrentTrackKey = currentTrackKey;
      self.addEvent(null, 'currentTrack', null, currentTrackKey);
    }
  }

  function addAutoPauseEvent() {
    self.addEvent(null, 'autoPause');
  }

  function addStreamerConnectEvent(client) {
    self.addEvent(client.user, 'streamStart');
  }

  function addStreamerDisconnectEvent(client) {
    self.addEvent(client.user, 'streamStop');
  }

  function maybeAddAnonStreamerConnectEvent(client) {
    if (!client) {
      self.addEvent(null, 'streamStart');
    }
  }

  function maybeAddAnonStreamerDisconnectEvent(client) {
    if (!client) {
      self.addEvent(null, 'streamStop');
    }
  }

  function addSubscription(name, serializeFn) {
    return addPermSubscription(name, null, serializeFn);
  }

  function addPermSubscription(name, perm, serializeFn) {
    var subscription = self.subscriptions[name] = {
      version: uuid(),
      value: serializeFn(),
      perm: perm,
    };
    return function() {
      var newValue = serializeFn();
      var delta = curlydiff.diff(subscription.value, newValue);
      if (delta === undefined) return; // no delta, nothing to send!
      subscription.value = newValue;
      subscription.version = uuid();
      self.forEachClient(function(client) {
        var clientSubscription = client.subscriptions[name];
        if (clientSubscription === 'simple') {
          client.sendMessage(name, newValue);
        } else if (clientSubscription === 'delta') {
          client.sendMessage(name, {
            version: subscription.version,
            delta: delta,
          });
        }
      });
    };
  }

  function getVolume(client) {
    return self.player.volume;
  }

  function getTime(client) {
    return new Date();
  }

  function getHardwarePlayback(client) {
    return self.player.desiredPlayerHardwareState;
  }

  function getRepeat(client) {
    return self.player.repeat;
  }

  function getCurrentTrack() {
    return {
      currentItemId: self.player.currentTrack && self.player.currentTrack.id,
      isPlaying: self.player.isPlaying,
      trackStartDate: self.player.trackStartDate,
      pausedTime: self.player.pausedTime,
    };
  }

  function getDynamicModeOn() {
    return self.player.dynamicModeOn;
  }

  function getDynamicModeFutureSize() {
    return self.player.dynamicModeFutureSize;
  }

  function getDynamicModeHistorySize() {
    return self.player.dynamicModeHistorySize;
  }

  function serializeQueue() {
    var playlist = self.player.playlist;
    var o = {};
    for (var id in playlist) {
      var item = playlist[id];
      o[id] = {
        key: item.key,
        sortKey: item.sortKey,
        isRandom: item.isRandom,
      };
    }
    return o;
  }

  function serializeLibrary() {
    var table = {};
    for (var key in self.player.libraryIndex.trackTable) {
      var track = self.player.libraryIndex.trackTable[key];
      table[key] = Player.trackWithoutIndex('read', track);
    }
    return table;
  }

  function serializeScanState() {
    var ongoingScans = self.player.ongoingScans;
    var o = {};
    for (var key in ongoingScans) {
      var item = ongoingScans[key];
      o[key] = {
        fingerprintDone: item.fingerprintDone,
        loudnessDone: item.loudnessDone,
      };
    }
    return o;
  }

  function serializePlaylists() {
    return self.player.playlists;
  }

  function serializeStreamers() {
    var anonCount = 0;
    self.player.openStreamers.forEach(function(openStreamer) {
      if (!openStreamer.client) {
        anonCount += 1;
      }
    });
    return anonCount;
  }

  function getUsers() {
    var users = {};
    var outUser;
    for (var id in self.users) {
      var user = self.users[id];
      outUser = {
        name: user.name,
        perms: extend({}, user.perms),
      };
      if (user.requested) outUser.requested = true;
      if (user.approved) outUser.approved = true;
      users[id] = outUser;
    }
    for (var clientId in self.clients) {
      var client = self.clients[clientId];
      outUser = users[client.user.id];
      outUser.connected = true;
      if (client.streaming) outUser.streaming = true;
    }
    return users;
  }

  function getEvents() {
    var events = {};
    for (var id in self.events) {
      var ev = self.events[id];
      var outEvent = {
        date: ev.date,
        type: ev.type,
        sortKey: ev.sortKey,
      };
      events[ev.id] = outEvent;
      if (ev.userId) {
        outEvent.userId = ev.userId;
      }
      if (ev.text) {
        outEvent.text = ev.text;
      }
      if (ev.trackId) {
        outEvent.trackId = ev.trackId;
      }
      if (ev.pos) {
        outEvent.pos = ev.pos;
      }
    }
    return events;
  }

  function getHaveAdminUser() {
    return self.haveAdminUser();
  }

  function serializeImportProgress() {
    var out = {};
    for (var id in self.player.importProgress) {
      var ev = self.player.importProgress[id];
      var outEvent = {
        date: ev.date,
        filenameHintWithoutPath: ev.filenameHintWithoutPath,
        bytesWritten: ev.bytesWritten,
        size: ev.size,
      };
      out[ev.id] = outEvent;
    }
    return out;
  }
};

PlayerServer.prototype.checkLastStreamerDisconnected = function() {
  var streamerCount = 0;
  this.forEachClient(function(client) {
    streamerCount += client.streaming;
  });
  if (this.player.openStreamers.length === 0 && streamerCount === 0) {
    this.player.lastStreamerDisconnected();
  }
};

PlayerServer.prototype.init = function(cb) {
  var self = this;

  var pend = new Pend();
  pend.go(loadAllUsers);
  pend.go(loadAllEvents);
  pend.wait(cb);

  function loadAllUsers(cb) {
    dbIterate(self.db, USERS_KEY_PREFIX, processOne, function(err) {
      if (err) return cb(err);
      self.ensureGuestUser();
      self.computeUsersIndex();
      self.emit('users');
      self.emit('haveAdminUser');
      cb();
    });
    function processOne(key, value) {
      var user = deserializeUser(value);
      self.users[user.id] = user;
    }
  }

  function loadAllEvents(cb) {
    dbIterate(self.db, EVENTS_KEY_PREFIX, processOne, function(err) {
      if (err) return cb(err);
      self.cacheEventsArray();
      self.emit('events');
      cb();
    });
    function processOne(key, value) {
      var ev = deserializeEvent(value);
      self.events[ev.id] = ev;
    }
  }
};

PlayerServer.prototype.forEachClient = function(fn) {
  for (var id in this.clients) {
    var client = this.clients[id];
    fn(client);
  }
};

PlayerServer.prototype.createGuestUser = function() {
  var user = true;
  var name;
  while (user) {
    name = this.guestUser.name + "-" + uuid.len(6);
    user = this.usernameIndex[name];
  }
  user = {
    id: uuid(),
    name: name,
    password: "",
    registered: false,
    requested: false,
    approved: false,
    perms: extend({}, this.guestUser.perms),
  };
  this.users[user.id] = user;
  this.computeUsersIndex();
  this.saveUser(user);
  return user;
};

PlayerServer.prototype.unsubscribe = function(client, name) {
  delete client.subscriptions[name];
};

PlayerServer.prototype.logout = function(client) {
  client.user = this.createGuestUser();
  // unsubscribe from subscriptions that the client no longer has permissions for
  for (var name in client.subscriptions) {
    var subscription = this.subscriptions[name];
    if (!client.userHasPerm(subscription.perm)) {
      this.unsubscribe(client, name);
    }
  }
  this.sendUserMessage(client);
};

PlayerServer.prototype.handleNewClient = function(client) {
  var self = this;
  client.subscriptions = {};

  // this is a secret; if a user finds out the client.id they can execute
  // commands on behalf of that user.
  client.id = uuid();

  client.user = self.createGuestUser();
  client.streaming = false;
  self.clients[client.id] = client;
  client.on('message', onMessage);
  self.sendUserMessage(client);
  client.sendMessage('time', new Date());
  client.sendMessage('token', client.id);
  client.on('close', onClose);
  PlayerServer.plugins.forEach(function(plugin) {
    plugin.handleNewClient(client);
  });

  function onClose() {
    self.addEvent(client.user, 'part');
    delete self.clients[client.id];
    self.emit('users');
    self.checkLastStreamerDisconnected();
  }

  function onMessage(name, args) {
    var action = PlayerServer.actions[name];
    if (!action) {
      log.warn("Invalid command:", name);
      client.sendMessage("error", "invalid command: " + JSON.stringify(name));
      return;
    }
    var perm = action.permission;
    if (perm != null && !client.userHasPerm(perm)) {
      var errText = "command " + JSON.stringify(name) +
        " requires permission " + JSON.stringify(perm);
      log.warn("permissions error:", errText);
      client.sendMessage("error", errText);
      return;
    }
    var argsType = Array.isArray(args) ? 'array' : typeof args;
    if (action.args && argsType !== action.args) {
      log.warn("expected arg type", action.args, args);
      client.sendMessage("error", "expected " + action.args + ": " + JSON.stringify(args));
      return;
    }
    log.debug("ok command", name, args);
    action.fn(self, client, args);
  }
};

PlayerServer.prototype.userHasPerm = function(user, perm) {
  if (!perm) {
    return true;
  }
  user = user ? this.users[user.id] : null;
  var perms = this.getUserPerms(user);
  return perms[perm];
};

PlayerServer.prototype.getUserPerms = function(user) {
  return (!user || !user.approved) ? this.guestUser.perms : user.perms;
};

PlayerServer.prototype.requestApproval = function(client) {
  client.user.requested = true;
  client.user.registered = true;
  this.saveUser(client.user);
  this.emit('users');
};

PlayerServer.prototype.login = function(client, username, password) {
  var errText;
  if (!password) {
    errText = "empty password";
    log.warn("Refusing to login:", errText);
    client.sendMessage('error', errText);
    return;
  }
  var user = this.usernameIndex[username];
  if (!user) {
    client.user.name = username;
    client.user.password = password;
    client.user.registered = true;

    this.computeUsersIndex();
    this.saveUser(client.user);

    this.emit('users');

    this.addEvent(client.user, 'register');
    return;
  }

  if (user === client.user) {
    user.name = username;
    user.password = password;
    this.computeUsersIndex();
    this.saveUser(user);
    this.emit('users');
    return;
  }

  if (!user.password || user.password !== password) {
    errText = "invalid login";
    log.warn(errText);
    client.sendMessage('error', errText);
    return;
  }

  var oldUser = client.user;
  client.user = user;

  if (!oldUser.registered) {
    var cmds = [];
    this.mergeUsers(cmds, oldUser, user);
    if (cmds.length > 0) {
      this.db.batch(cmds, logIfError);
    }
  }

  this.emit('users');

  this.addEvent(client.user, 'login');

  function logIfError(err) {
    if (err) {
      log.error("Unable to modify users:", err.stack);
    }
  }
};

PlayerServer.prototype.mergeUsers = function(cmds, dupeUser, canonicalUser) {
  for (var eventId in this.events) {
    var ev = this.events[eventId];
    if (ev.userId === dupeUser.id) {
      ev.userId = canonicalUser.id;
      cmds.push({type: 'put', key: eventKey(ev), value: serializeEvent(ev)});
    }
  }
  this.forEachClient(function(client) {
    if (client.user === dupeUser) {
      client.user = canonicalUser;
    }
  });
  cmds.push({type: 'del', key: userKey(dupeUser)});
  cmds.push({type: 'put', key: userKey(canonicalUser), value: serializeUser(canonicalUser)});
  delete this.users[dupeUser.id];
};

PlayerServer.prototype.computeUsersIndex = function() {
  this.usernameIndex = {};
  this.oneLineAuth = {};
  for (var id in this.users) {
    var user = this.users[id];
    this.usernameIndex[user.name] = user;
    this.oneLineAuth[user.name + '/' + user.password] = user;
  }
};

PlayerServer.prototype.sendUserMessage = function(client) {
  client.sendMessage('user', {
    id: client.user.id,
    name: client.user.name,
    perms: client.getUserPerms(),
    registered: client.user.registered,
    requested: client.user.requested,
    approved: client.user.approved,
  });
};

PlayerServer.prototype.saveUser = function(user) {
  this.db.put(userKey(user), serializeUser(user), function(err) {
    if (err) {
      log.error("Unable to save user:", err.stack);
    }
  });
};

PlayerServer.prototype.processApprovals = function(approvals) {
  var cmds = [];
  var eventsModified = false;

  var connectedUserIds = {};
  for (var id in this.clients) {
    var client = this.clients[id];
    connectedUserIds[client.user.id] = true;
  }

  for (var i = 0; i < approvals.length; i += 1) {
    var approval = approvals[i];
    var user = this.users[approval.id];
    var replaceUser = this.users[approval.replaceId];
    if (!user) continue;
    if (!approval.approved) {
      user.requested = false;
      cmds.push({type: 'put', key: userKey(user), value: serializeUser(user)});
    } else if (replaceUser && user !== replaceUser) {
      replaceUser.name = approval.name;

      eventsModified = true;
      this.mergeUsers(cmds, user, replaceUser);
    } else {
      user.name = approval.name;
      user.approved = true;
      cmds.push({type: 'put', key: userKey(user), value: serializeUser(user)});
    }
  }

  if (cmds.length > 0) {
    this.computeUsersIndex();
    this.db.batch(cmds, logIfError);
    if (eventsModified) {
      this.emit('events');
    }
    this.emit('users');
  }

  function logIfError(err) {
    if (err) {
      log.error("Unable to modify users:", err.stack);
    }
  }
};

PlayerServer.prototype.cacheEventsArray = function() {
  var self = this;
  self.eventsInOrder = Object.keys(self.events).map(eventById);
  self.eventsInOrder.sort(asc);
  self.eventsInOrder.forEach(function(ev, index) {
    ev.index = index;
  });

  function asc(a, b) {
    return operatorCompare(a.sortKey, b.sortKey);
  }
  function eventById(id) {
    return self.events[id];
  }
};

PlayerServer.prototype.addEvent = function(user, type, text, trackKey, pos, dedupe) {
  var lastEvent = this.eventsInOrder[this.eventsInOrder.length - 1];
  if ('string' != (typeof lastEvent.sortKey)) {
    console.log("bad sort key: " + lastEvent.sortKey);
    lastEvent = undefined;
  }
  if (dedupe && lastEvent.type === type && lastEvent.userId === user.id) {
    return;
  }
  var ev = {
    id: uuid(),
    date: new Date(),
    userId: user && user.id,
    type: type,
    sortKey: keese(lastEvent && lastEvent.sortKey, null),
    text: text,
    trackId: trackKey,
    pos: pos,
  };
  this.events[ev.id] = ev;
  this.eventsInOrder.push(ev);
  var extraEvents = this.eventsInOrder.length - MAX_EVENT_COUNT;
  var cmds = [];
  var usersChanged = 0;
  var haveAdminUserChange = false;
  if (extraEvents > 0) {
    var scrubUserIds = {};
    var i;
    for (i = 0; i < extraEvents; i += 1) {
      var thisEvent = this.eventsInOrder[i];
      if (thisEvent.user && !thisEvent.user.approved) {
        scrubUserIds[thisEvent.user.id] = true;
      }
      deleteEventCmd(cmds, thisEvent);
      delete this.events[thisEvent.id];
    }
    this.eventsInOrder.splice(0, extraEvents);
    // scrub users associated with these deleted events if they are not
    // referenced anywhere else
    for (i = 0; i < this.eventsInOrder.length; i += 1) {
      delete scrubUserIds[this.eventsInOrder[i].userId];
    }
    for (var clientId in this.clients) {
      delete scrubUserIds[this.clients[clientId].user.id];
    }
    for (var userId in scrubUserIds) {
      usersChanged += 1;
      var deletedUser = this.users[userId];
      delete this.users[userId];
      cmds.push({type: 'del', key: userKey(deletedUser)});
      haveAdminUserChange = haveAdminUserChange || deletedUser.perms.admin;
    }
  }
  cmds.push({type: 'put', key: eventKey(ev), value: serializeEvent(ev)});
  this.db.batch(cmds, logIfError);
  this.emit('events');
  if (usersChanged > 0) {
    this.emit('users');
  }
  if (haveAdminUserChange) {
    this.emit('haveAdminUser');
  }

  function logIfError(err) {
    if (err) {
      log.error("Unable to modify events:", err.stack);
    }
  }
};

PlayerServer.prototype.updateUser = function(client, userId, perms) {
  var user = this.users[userId];
  if (!user) {
    var errText = "invalid user id";
    log.warn("unable to update user: " + errText);
    client.sendMessage('error', errText);
    return;
  }

  var guestUserChanged = (user === this.guestUser);

  extend(user.perms, perms);
  this.saveUser(user);


  for (var id in this.clients) {
    client = this.clients[id];
    if (client.user === user || (guestUserChanged && !client.user.approved)) {
      this.sendUserMessage(client);
    }
  }
  this.emit('haveAdminUser');
  this.emit('users');
};

PlayerServer.prototype.validateObject = function(client, val) {
  if (typeof val !== 'object' || Array.isArray(val)) {
    var errText = "expected object";
    log.warn("invalid command: " + errText);
    client.sendMessage('error', errText);
    return false;
  }
  return true;
};

PlayerServer.prototype.validateFloat = function(client, val) {
  if (typeof val !== 'number' || isNaN(val)) {
    var errText = "expected number";
    log.warn("invalid command: " + errText);
    client.sendMessage('error', errText);
    return false;
  }
  return true;
};

PlayerServer.prototype.validateString = function(client, val, maxLength) {
  var errText;
  if (typeof val !== 'string') {
    errText = "expected string";
    log.warn("invalid command: " + errText);
    client.sendMessage('error', errText);
    return false;
  }

  if (maxLength != null && val.length > maxLength) {
    errText = "string too long";
    log.warn("invalid command:", errText);
    client.sendMessage('error', errText);
    return false;
  }

  return true;
};

PlayerServer.prototype.validateBoolean = function(client, val) {
  var errText;
  if (typeof val !== 'boolean') {
    errText = "expected boolean";
    log.warn("invalid command: " + errText);
    client.sendMessage('error', errText);
    return false;
  }

  return true;
};

PlayerServer.prototype.deleteUsers = function(ids) {
  var cmds = [];

  var haveAdminUserChange = false;
  var eventsChange = false;
  for (var i = 0; i < ids.length; i += 1) {
    var userId = ids[i];
    var user = this.users[userId];
    if (!user || user === this.guestUser) continue;

    var deleteEvents = [];
    var ev;
    for (var eventId in this.events) {
      ev = this.events[eventId];
      if (ev.userId === userId) {
        deleteEvents.push(ev);
      }
    }
    eventsChange = eventsChange || (deleteEvents.length > 0);
    for (var j = 0; j < deleteEvents.length; j += 1) {
      ev = deleteEvents[j];
      cmds.push({type: 'del', key: eventKey(ev)});
      delete this.events[ev.id];
    }

    cmds.push({type: 'del', key: userKey(user)});
    haveAdminUserChange = haveAdminUserChange || user.perms.admin;
    delete this.users[userId];
    for (var clientId in this.clients) {
      var client = this.clients[clientId];
      if (client.user === user) {
        this.logout(client);
        break;
      }
    }
  }

  if (cmds.length > 0) {
    this.computeUsersIndex();
    this.db.batch(cmds, logIfError);
  }

  if (eventsChange) {
    this.emit('events');
  }
  this.emit('users');
  if (haveAdminUserChange) {
    this.emit('haveAdminUser');
  }

  function logIfError(err) {
    if (err) {
      log.error("Unable to delete users:", err.stack);
    }
  }
};

PlayerServer.prototype.getOneLineAuth = function(passwordString) {
  return this.oneLineAuth[passwordString];
};

PlayerServer.deleteAllUsers = function(db) {
  var cmds = [];
  var usersDeleted = 0;
  var eventsDeleted = 0;

  var pend = new Pend();
  pend.go(function(cb) {
    dbIterate(db, USERS_KEY_PREFIX, processOne, cb);

    function processOne(key, value) {
      cmds.push({type: 'del', key: key});
      usersDeleted += 1;
    }
  });
  pend.go(function(cb) {
    dbIterate(db, EVENTS_KEY_PREFIX, processOne, cb);
    function processOne(key, value) {
      cmds.push({type: 'del', key: key});
      eventsDeleted += 1;
    }
  });
  pend.wait(function(err) {
    if (err) throw err;
    db.batch(cmds, function(err) {
      if (err) throw err;
      log.info("Users deleted: " + usersDeleted);
      log.info("Events deleted: " + eventsDeleted);
      process.exit(0);
    });
  });
};

function deleteEventCmd(cmds, ev) {
  cmds.push({type: 'del', key: eventKey(ev)});
}

function serializeUser(user) {
  return JSON.stringify(user);
}

function deserializeUser(payload) {
  return JSON.parse(payload);
}

function serializeEvent(ev) {
  return JSON.stringify(ev);
}

function deserializeEvent(payload) {
  return JSON.parse(payload);
}

function extend(o, src) {
  for (var key in src) o[key] = src[key];
  return o;
}

function userKey(user) {
  return USERS_KEY_PREFIX + user.id;
}

function eventKey(ev) {
  return EVENTS_KEY_PREFIX + ev.id;
}

function operatorCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
