# FIST extensions

An extension is a folder containing:

- `extension.json` -- manifest: `{ "id", "name", "version", "description", "entry" }`. `entry` is the script FIST spawns as a plain Node child process (via `node <entry>`, no Electron APIs available).
- The entry script itself.

Install one via Settings -> Extensions -> Install Extension..., pointing at the folder (not a zip). Installing an extension runs it with the same privileges as any other program on your machine -- FIST does not sandbox what an extension's code does, only isolates it into its own OS process so it can't directly touch FIST's own process.

## Protocol

The entry script talks to FIST over newline-delimited JSON on stdin/stdout.

**Parse a config** (used when the user picks your extension to add a config):
```
host -> ext   {"id":1,"cmd":"parse","text":"<whatever the user pasted or imported>"}
ext  -> host  {"id":1,"ok":true,"profile":{"name":"...","address":"...","port":123}}
              {"id":1,"ok":false,"error":"..."}
```

**Connect** (your extension owns everything from here -- open your own local proxy, stand up your own TUN device, spawn your own VPN binary, whatever the protocol needs):
```
host -> ext   {"id":2,"cmd":"connect","profile":{...whatever you returned from parse...}}
ext  -> host  {"id":2,"ok":true}
```
At any point after that, you can push unsolicited events:
```
ext -> host   {"event":"state","state":"connected"}
ext -> host   {"event":"state","state":"disconnected"}   (e.g. if the tunnel drops on its own)
ext -> host   {"event":"log","message":"..."}
```

**Disconnect:**
```
host -> ext   {"id":3,"cmd":"disconnect"}
ext  -> host  {"id":3,"ok":true}
```

FIST kills the process shortly after disconnect completes (or after a timeout if your extension doesn't respond).

See `demo-engine/` for a minimal but real working example (a `demo-tcp://host:port#name` link that opens an actual local TCP forwarder on connect).
