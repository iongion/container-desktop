# How to build

1. Preparing the infrastructure

    ```bash
    inv prepare
    ```

2. Build the application

    ```bash
    NODE_ENV=production ENVIRONMENT=production inv build
    ```

3. Create bundles (tar.gz, dmg, exe)

    ```bash
    NODE_ENV=production ENVIRONMENT=production inv bundle
    ```

Then see `shell/dist` for the output assets.
