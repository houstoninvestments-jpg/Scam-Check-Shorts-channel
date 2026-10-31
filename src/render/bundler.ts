/** The video bundler reads our source as written: "./x.js" in an import means the file x.ts. */
export const resolveTsFromJs = <T extends { resolve?: object }>(c: T): T => ({ ...c, resolve: { ...c.resolve, extensionAlias: { ".js": [".ts", ".tsx", ".js"] } } });
