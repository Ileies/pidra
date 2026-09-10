// libmime ships no typings. Only the surface we actually use is declared here.
declare module "libmime" {
  interface LibMime {
    /**
     * Decodes RFC 2047 encoded-words (`=?UTF-8?Q?...?=`) anywhere in a string, leaving plain
     * text untouched.
     */
    decodeWords(str: string): string;
  }
  const libmime: LibMime;
  export default libmime;
}
