# Workflows: Solo vs Team

## Conceptual Background

The goal is to simplify the development lifecycle by distinguishing between two primary workflows: **Solo** and **Team**. This distinction clarifies how schema changes are propagated to the database, making it easier for both administrators and developers to manage the project evolution.

## Workflow 1: Solo (Default)

**Solo** workflow is the default starting point for new Glaze projects. It is designed for speed and simplicity, while remaining safe for production use thanks to strict validation defaults.

- **Behavior:**
  - Changes to the schema (code or Admin UI) are directly pushed to the database.
  - Drift detection matches the live database against the current schema state.
  - No migration artifacts (SQL files or snapshots) are generated or stored.
  - Ideal for rapid iteration where history is less critical than state.

## Workflow 2: Team

**Team** workflow adds audit trails and strict version control, making it ideal for collaborative environments.

- **Behavior:**
  - Changes to the schema must be captured in migration artifacts (SQL statements and schema snapshots).
  - Database updates are applied by running these migrations.
  - Ensures all team members apply the same sequence of changes.
  - Prevents conflicts and accidental overrides in shared environments.

## Constraints & Transitions

### Upgrade Path

- **Solo -> Team:** You can upgrade to Team mode at any time. This involves generating the initial migration history from the current state.

### Irreversibility

- **NO RETURN:** Once a project is upgraded to **Team** mode, **IT CANNOT GO BACK TO SOLO WORKFLOW**.
- **Reason:** Team mode establishes a strict migration history that Solo mode ignores. Reverting would risk data integrity and schema sync issues.

## Workflow Metadata

Glaze tracks the current workflow mode in `.glaze/metadata.json`. This file is automatically created and maintained by Convergence.

### File Structure

```json
{
  "workflow": "solo" | "team",
  "transitionedAt": "2025-01-15T12:00:00.000Z" | null
}
```

- **`workflow`**: Current workflow mode (`solo` or `team`).
- **`transitionedAt`**: ISO timestamp of when the project transitioned to Team mode (`null` for Solo).

### Behavior

- **First Run**: If `metadata.json` doesn't exist, Glaze defaults to `solo` workflow and creates:
  - `.glaze/metadata.json` - Workflow state (tracked in git)
  - `.glaze/.gitignore` - Git configuration (tracked) that ensures `prototype.json` is ignored
- **Upgrade to Team**: When switching to Team mode, `transitionedAt` is set to the current timestamp.
- **Blocked Downgrade**: If a project is in Team mode and the config attempts to switch to Solo, Convergence throws an error with manual override instructions.

### Manual Override

If you **must** revert to Solo (at your own risk):

1. Backup your database.
2. Delete `.glaze/metadata.json`.
3. Restart the server.

> ⚠️ **Warning**: This will lose all migration tracking history.
