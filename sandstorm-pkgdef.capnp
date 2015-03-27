@0xe6391d0709201983;

using Spk = import "/sandstorm/package.capnp";
# This imports:
#   $SANDSTORM_HOME/latest/usr/include/sandstorm/package.capnp
# Check out that file to see the full, documented package definition format.

const pkgdef :Spk.PackageDefinition = (
  # The package definition. Note that the spk tool looks specifically for the
  # "pkgdef" constant.

  id = "wfg1r0qra2ewyvns05r0rddqttt57qxurz3nz5z95rjnm63et7e0",
  # Your app ID is actually its public key. The private key was placed in
  # your keyring. All updates must be signed with the same key.

  manifest = (
    appTitle = (defaultText = "Groove Basin"),
    appVersion = 3,  # Increment this for every release.

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
        # You probably don't want the app pulling files from these places,
        # so we hide them. Note that /dev, /var, and /tmp are implicitly
        # hidden because Sandstorm itself provides them.
      )
    ]
  ),

  fileList = "sandstorm-files.list",

  alwaysInclude = [],

  bridgeConfig = (
    viewInfo = (
       permissions = [(name = "admin"),
                      (name = "read"),
                      (name = "add"),
                      (name = "control",
                       title = (defaultText ="" )),
                      (name = "playlist")],
       roles = [(title = (defaultText = "listener"),
                 permissions = .listenerPermissions,
                 verbPhrase = (defaultText = "can listen")),
                 (title = (defaultText = "contributer"),
                 permissions = .contributorPermissions,
                 verbPhrase = (defaultText = "can listen and add tracks"))
                 ]
    )
  )
);

#                                                admin | read |  add | control | playlist |
const listenerPermissions : List(Bool)        = [ false,  true, false,     true,    true];
const contributorPermissions : List(Bool)     = [ false,  true,  true,     true,    true];

const myCommand :Spk.Manifest.Command = (
  argv = ["/sandstorm-http-bridge", "10000", "--", "/bin/sh", "start.sh"],
  environ = [
    # Note that this defines the *entire* environment seen by your app.
    (key = "PATH", value = "/usr/local/bin:/usr/bin:/bin")
  ]
);
