declare module "sql.js" {
  export interface SqlValue {
    [key: string]: string | number | null | Uint8Array;
  }

  export interface Database {
    run(sql: string, params?: (string | number | null)[]): void;
    prepare(sql: string): Statement;
    getRowsModified(): number;
    export(): Uint8Array;
    close(): void;
  }

  export interface Statement {
    bind(params?: (string | number | null)[]): void;
    step(): boolean;
    getAsObject(): SqlValue;
    free(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer) => Database;
  }

  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
