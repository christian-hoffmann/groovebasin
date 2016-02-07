@0xe6391d0709201983;

using Spk = import "/sandstorm/package.capnp";

const pkgdef :Spk.PackageDefinition = (
  id = "wfg1r0qra2ewyvns05r0rddqttt57qxurz3nz5z95rjnm63et7e0",

  manifest = (
    appTitle = (defaultText = "Groove Basin"),
    appVersion = 8,  # Increment this for every release.
    appMarketingVersion = (defaultText = "2016.02.06 (1.5.1+)"),

    metadata = (
      icons = (
        appGrid = (png = (dpi1x = embed "app-graphics/groovebasin-128.png",
                          dpi2x = embed "app-graphics/groovebasin-256.png")),
        grain = (png = (dpi1x = embed "app-graphics/groovebasin-24.png",
                        dpi2x = embed "app-graphics/groovebasin-48.png")),
        market = (png = (dpi1x = embed "app-graphics/groovebasin-150.png")),
      ),
      website = "http://groovebasin.com",
      codeUrl = "https://github.com/dwrensha/groovebasin",
      license = (openSource = mit),
      categories = [media,],
      author = (
        upstreamAuthor = "Andrew Kelley",
        contactEmail = "david@sandstorm.io",
        pgpSignature = embed "pgp-signature",
      ),
      pgpKeyring = embed "pgp-keyring",
      description = (defaultText = embed "description.md"),
      screenshots = [(width = 448, height = 311, png = embed "screenshot.png")],
      changeLog = (defaultText = embed "changeLog.md"),
    ),


    actions = [
      ( title = (defaultText = "New Music Library"),
        command = .myCommand,
        nounPhrase = (defaultText = "Music Library")
      )
    ],

    continueCommand = .myCommand
  ),

  sourceMap = (
    searchPath = [
      ( sourcePath = "." ),  # Search this directory first.
      ( sourcePath = "/opt/app"),
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
                (title = (defaultText = "disc jockey"),
                 permissions = .djPermissions,
                 verbPhrase =
                    (defaultText = "can control the stream, upload tracks, and edit playlists"),
                 default = true),
                (title = (defaultText = "administrator"),
                 permissions = .adminPermissions,
                 verbPhrase = (defaultText = "can do anything")),
                (title = (defaultText = "listener"),
                 permissions = .listenerPermissions,
                 verbPhrase = (defaultText = "can only listen")),
                (title = (defaultText = "contributor"),
                 permissions = .contributorPermissions,
                 verbPhrase = (defaultText = "can upload tracks and edit playlists"))
                 ]
    )
  )
);

#                                                 admin | read |  add | control | playlist |
const controllerPermissions : List(Bool)       = [ false,  true, false,     true,    false];
const djPermissions : List(Bool)               = [ false,  true,  true,     true,    true];
const adminPermissions : List(Bool)            = [ true,   true,  true,      true,    true];
const listenerPermissions : List(Bool)         = [ false,  true, false,     false,    false];
const contributorPermissions : List(Bool)      = [ false,  true,  true,     false,    true];

const myCommand :Spk.Manifest.Command = (
  argv = ["/sandstorm-http-bridge", "10000", "--", "/bin/sh", "start.sh"],
  environ = [
    # Note that this defines the *entire* environment seen by your app.
    (key = "PATH", value = "/usr/local/bin:/usr/bin:/bin")
  ]
);
