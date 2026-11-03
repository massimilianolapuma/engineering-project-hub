/** Minimal typing of @primer/octicons (the package ships no types): name → icon with toSVG. */
declare module '@primer/octicons' {
  const octicons: Record<string, { toSVG(options?: Record<string, string | number>): string }>;
  export default octicons;
}
