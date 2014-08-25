var EventEmitter = require('events').EventEmitter;
var util = require('util');
var log = require('./log');

module.exports = WebSocketApiClient;

util.inherits(WebSocketApiClient, EventEmitter);
function WebSocketApiClient(ws) {
  if (ws.upgradeReq.headers['x-sandstorm-permissions'].split(',').indexOf('admin') > -1) {
    console.log("ADMIN");
    this.isAdmin = true;
  }

  EventEmitter.call(this);
  this.ws = ws;
  this.initialize();
}

var adminPerms = {read: true, add: true, control: true, admin: true, };
var guestPerms = {read: true, add: true, control: true, admin: false, };

WebSocketApiClient.prototype.userHasPerm = function(perm) {
  if (!perm) {
    return true;
  }
  if (this.isAdmin) {
    return true;
  } else {
    return guestPerms[perm];
  }
}

WebSocketApiClient.prototype.getUserPerms = function() {
  if (this.isAdmin) {
    return adminPerms;
  } else {
    return guestPerms;
  }
}


WebSocketApiClient.prototype.sendMessage = function(name, args) {
  try {
    this.ws.send(JSON.stringify({
      name: name,
      args: args,
    }));
  } catch (err) {
    // nothing to do
    // client might have disconnected by now
  }
};

WebSocketApiClient.prototype.close = function() {
  this.ws.close();
};

WebSocketApiClient.prototype.initialize = function() {
  var self = this;
  self.ws.on('message', function(data, flags) {
    if (flags.binary) {
      log.warn("ignoring binary web socket message");
      return;
    }
    var msg;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      log.warn("received invalid JSON from web socket:", err.message);
      return;
    }
    self.emit('message', msg.name, msg.args);
  });
  self.ws.on('error', function(err) {
    log.error("web socket error:", err.stack);
  });
  self.ws.on('close', function() {
    self.emit('close');
  });
};
