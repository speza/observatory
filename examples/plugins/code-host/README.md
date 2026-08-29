# Example code-host plugin

This deliberately small package proves that a contributed integration can add
a code-host capability without editing Observatory core. It imports only the
public plugin SDK, declares the capability in `observatory.plugin.json`, and
returns provider-neutral observations.

Enable it through a local configuration file:

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "path": "/absolute/path/to/observatory/examples/plugins/code-host",
      "enabled": true,
      "config": {}
    }
  ]
}
```

Then start Observatory with `AO_PLUGIN_CONFIG=/absolute/path/to/plugins.json`.

Plugins are trusted in-process code. Enabling one grants it the same local file,
environment and network access as Observatory. Install and enable only code you
trust. Provider credentials should remain in the provider's own credential
store; do not put tokens in plugin configuration.
