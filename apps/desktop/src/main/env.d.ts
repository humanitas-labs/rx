// electron-vite copies `?asset` imports into the build output and resolves
// them to an absolute path at runtime (dev and packaged).
declare module '*.wasm?asset' {
  const path: string;
  export default path;
}
