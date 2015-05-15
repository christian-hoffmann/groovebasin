@0xe6391d0709201983;

using Spk = import "/sandstorm/package.capnp";

const pkgdef :Spk.PackageDefinition = (
  id = "wfg1r0qra2ewyvns05r0rddqttt57qxurz3nz5z95rjnm63et7e0",

  manifest = (
    appTitle = (defaultText = "Groove Basin"),
    appVersion = 6,  # Increment this for every release.
    appMarketingVersion = (defaultText = "0.0.6"),

    actions = [
      ( title = (defaultText = "New Music Library"),
        command = .myCommand
      )
    ],

    continueCommand = .myCommand
  ),

  sourceMap = (
    searchPath = [
      ( sourcePath = "." ),  # Search this directory first.
      ( sourcePath = "/",    # Then search the system root directory.
        hidePaths = [ "home", "proc", "sys",
                      "etc/passwd", "etc/nsswitch.conf"]
      )
    ]
  ),

  fileList = "sandstorm-files.list",

  alwaysInclude = [],

  bridgeConfig = (
    viewInfo = (
       permissions = [(name = "admin", title = (defaultText = "admin"),
                       description = (defaultText = "allows tag editing and track deletion")),
                      (name = "read", title = (defaultText = "read"),
                       description = (defaultText = "allows listening and downloading")),
                      (name = "add", title = (defaultText = "add"),
                       description = (defaultText = "allows track uploads")),
                      (name = "control", title = (defaultText = "control"),
                       description = (defaultText = "allows control of the audio stream")),
                      (name = "playlist", title = (defaultText = "playlist"),
                       description = (defaultText = "allows playlist editing"))],
       roles = [(title = (defaultText = "controller"),
                 permissions = .controllerPermissions,
                 verbPhrase = (defaultText = "can control the stream")),
                (title = (defaultText = "contributor"),
                 permissions = .contributorPermissions,
                 verbPhrase =
                    (defaultText = "can control the stream, upload tracks, and edit playlists"),
                 default = true),
                (title = (defaultText = "administrator"),
                 permissions = .adminPermissions,
                 verbPhrase = (defaultText = "can do anything")),
                (title = (defaultText = "listener"),
                 permissions = .listenerPermissions,
                 verbPhrase = (defaultText = "can only listen"))
                 ]
    )
  )
);

#                                                 admin | read |  add | control | playlist |
const controllerPermissions : List(Bool)       = [ false,  true, false,     true,    false];
const contributorPermissions : List(Bool)      = [ false,  true,  true,     true,    true];
const adminPermissions : List(Bool)            = [ true,  true,  true,     true,    true];
const listenerPermissions : List(Bool)         = [ false,  true, false,     false,    false];

const myCommand :Spk.Manifest.Command = (
  argv = ["/sandstorm-http-bridge", "10000", "--", "/bin/sh", "start.sh"],
  environ = [
    # Note that this defines the *entire* environment seen by your app.
    (key = "PATH", value = "/usr/local/bin:/usr/bin:/bin")
  ]
);
