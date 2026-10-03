# setup-node-env

Composite action that installs Node.js on the runner and enables the npm cache. It wraps
`actions/setup-node` (pinned to a commit SHA). No job container is involved: Node.js goes
into the runner tool cache.

## Inputs

| Input               | Required | Default | Description                                                         |
| ------------------- | -------- | ------- | ------------------------------------------------------------------- |
| `node-version`      | no       | `24`    | Node.js version to install                                          |
| `working-directory` | no       | `.`     | npm project root; its `package-lock.json` is the npm cache key path |

## Usage

```yaml
- name: Setup Node.js environment
  uses: ./.github/actions/setup-node-env
  with:
    node-version: '24'
```

Run `npm ci` in a later step: this action only installs Node.js and restores the npm cache.
