var EventEmitter = require('events').EventEmitter;
var util = require('util');

module.exports = MpdApiServer;

// stuff that is global to all connected mpd clients
util.inherits(MpdApiServer, EventEmitter);
function MpdApiServer(player) {
  var self = this;
  EventEmitter.call(self);
  self.gbIdToMpdId = {};
  self.mpdIdToGbId = {};
  self.nextMpdId = 0;
  self.singleMode = false;
  self.clients = {};

  player.on('volumeUpdate', onVolumeUpdate);
  player.on('repeatUpdate', updateOptionsSubsystem);
  player.on('autoDjOn', updateOptionsSubsystem);
  player.on('queueUpdate', onQueueUpdate);
  player.on('deleteDbTrack', updateDatabaseSubsystem);
  player.on('updateDb', updateDatabaseSubsystem);
  player.on('playlistCreate', updateStoredPlaylistSubsystem);
  player.on('playlistUpdate', updateStoredPlaylistSubsystem);
  player.on('playlistDelete', updateStoredPlaylistSubsystem);

  function onVolumeUpdate() {
    self.subsystemUpdate('mixer');
  }
  function onQueueUpdate() {
    scrubStaleIdMappings(self, player);
    self.subsystemUpdate('playlist');
    self.subsystemUpdate('player');
  }
  function updateOptionsSubsystem() {
    self.subsystemUpdate('options');
  }
  function updateDatabaseSubsystem() {
    self.subsystemUpdate('database');
  }
  function updateStoredPlaylistSubsystem() {
    self.subsystemUpdate('stored_playlist');
  }
}

MpdApiServer.prototype.handleClientEnd = function(client) {
  delete this.clients[client.id];
};
MpdApiServer.prototype.handleNewClient = function(client) {
  this.clients[client.id] = client;
};

MpdApiServer.prototype.subsystemUpdate = function(subsystem) {
  for (var id in this.clients) {
    var client = this.clients[id];
    client.updatedSubsystems[subsystem] = true;
    if (client.isIdle) client.handleIdle();
  }
};

MpdApiServer.prototype.toMpdId = function(grooveBasinId) {
  var mpdId = this.gbIdToMpdId[grooveBasinId];
  if (!mpdId) {
    mpdId = this.nextMpdId++;
    this.gbIdToMpdId[grooveBasinId] = mpdId;
    this.mpdIdToGbId[mpdId] = grooveBasinId;
  }
  return mpdId;
};

MpdApiServer.prototype.fromMpdId = function(mpdId) {
  return this.mpdIdToGbId[mpdId];
};

MpdApiServer.prototype.setSingleMode = function(mode) {
  this.singleMode = mode;
  this.subsystemUpdate('options');
};

function scrubStaleIdMappings(self, player) {
  var idsToScrub = [];
  for (var gbId in self.gbIdToMpdId) {
    var mpdId = self.gbIdToMpdId[gbId];
    if (!player.playlist[gbId]) {
      idsToScrub.push(gbId);
      delete self.mpdIdToGbId[mpdId];
    }
  }
  idsToScrub.forEach(function(idToScrub) {
    delete self.gbIdToMpdId[idToScrub];
  });
}
