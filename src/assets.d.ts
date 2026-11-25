// `@types/bun` types `*.html` as an HTMLBundle; this project imports the shell as text.
declare module "*/shell.html" {
  const content: string;
  export default content;
}

declare module "*.css" {
  const content: string;
  export default content;
}
