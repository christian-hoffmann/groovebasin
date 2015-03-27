var EventEmitter = require('events').EventEmitter;
var util = require('util');
var log = require('./log');
var uuid = require('./uuid');

module.exports = WebSocketApiClient;

util.inherits(WebSocketApiClient, EventEmitter);
function WebSocketApiClient(ws, request) {
  this.permissions = {};
  var permissionsArray = request.headers['x-sandstorm-permissions'].split(',');
  for (var perm in emptyPerms) {
    this.permissions[perm] = (permissionsArray.indexOf(perm) != -1)
  }
  this.username = decodeURI(request.headers['x-sandstorm-username']);
  this.userid = request.headers['x-sandstorm-user-id'] || uuid();
  EventEmitter.call(this);
  this.ws = ws;
  this.initialize();
}

var emptyPerms = {read: false, add: false, control: false, playlist: false, admin: false, };
var adminPerms = {read: true, add: true, control: true, playlist: true, admin: true, };
var guestPerms = {read: true, add: true, control: true, playlist: false, admin: false, };

WebSocketApiClient.prototype.userHasPerm = function(perm) {
  if (!perm) {
    return true;
  }
  return this.permissions[perm];
}

WebSocketApiClient.prototype.getUserPerms = function() {
  return this.permissions;
}


WebSocketApiClient.prototype.sendMessage = function(name, args) {
  if (!this.ws.isOpen()) return;
  this.ws.sendText(JSON.stringify({
    name: name,
    args: args,
  }));
};

WebSocketApiClient.prototype.close = function() {
  this.ws.close();
};

WebSocketApiClient.prototype.initialize = function() {
  var self = this;
  self.ws.on('textMessage', function(data) {
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
