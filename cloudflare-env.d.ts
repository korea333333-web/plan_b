/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
  };
}

type D1Database = {
  prepare(query: string): any;
  batch(statements: any[]): Promise<any[]>;
  exec(query: string): Promise<any>;
  dump(): Promise<ArrayBuffer>;
};

type Fetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};
