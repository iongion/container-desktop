## Cleanup recommendation

Based on your **System Docker** connection, the images that are definitely safe to delete are the ones with
no repository or tag (they appear as `<none>`) — typically *dangling* layers no running container references.

- Dangling images tagged `<none>`
- Old `node:20-alpine` layers superseded by `node:22-alpine`

1. Reclaim space with a prune
2. Re-pull only what you actually need

| Image    | Tag       | Size   |
| -------- | --------- | ------ |
| nginx    | 1.27      | 142 MB |
| postgres | 15-alpine | 240 MB |

> Tip: `docker image prune` only removes dangling images unless you pass `-a`.

```bash
docker image prune -a --filter "until=240h"
```

See the [pruning guide](https://docs.docker.com/) for the full flag list.
