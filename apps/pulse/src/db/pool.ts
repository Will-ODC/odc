import pg, { type Pool } from "pg";

/**
 * The connection pool the migration runner uses. Deliberately thin: pulse has
 * no data layer yet, and the stores that land next will say what more they
 * need rather than having it guessed for them here.
 */
export interface PulsePoolConfig {
  connectionString: string;
  /**
   * Run every connection with this schema first on its `search_path`.
   *
   * Migrations name tables unqualified, so this is how the same schema can be
   * created in a throwaway namespace — which is what the runner's own tests
   * do, rather than scribbling on whatever database they are pointed at. It is
   * also the knob for deploying pulse beside something else in one database.
   */
  schema?: string;
}

/** Schema names go into a startup parameter, so they are not free text. */
const SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

export function createPool(config: PulsePoolConfig): Pool {
  const { connectionString, schema } = config;
  if (schema === undefined) return new pg.Pool({ connectionString });
  if (!SCHEMA_NAME.test(schema)) {
    throw new TypeError(`not a usable schema name: ${schema}`);
  }
  return new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
}
