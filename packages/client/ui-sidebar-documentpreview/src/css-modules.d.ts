declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css'

declare module '*?raw' {
  const content: string
  export default content
}

declare module '*?inline' {
  const content: string
  export default content
}
