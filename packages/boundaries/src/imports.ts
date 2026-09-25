import ts from 'typescript'

export interface ImportRecord {
  specifier: string
  line: number
}

const isLiteralSpecifier = (
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)

/**
 * Collect import specifiers via the TypeScript parser — comments and string
 * literals cannot produce false positives. Covers static import,
 * `import x = require("…")`, `export ... from`, dynamic `import()`, and
 * `require()` — including no-substitution template literals.
 */
export function collectImports(fileName: string, source: string): ImportRecord[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const records: ImportRecord[] = []
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1
  const push = (specifier: string, node: ts.Node) =>
    records.push({ specifier, line: lineOf(node.getStart(sf)) })

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isLiteralSpecifier(node.moduleSpecifier)) {
      push(node.moduleSpecifier.text, node)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isLiteralSpecifier(node.moduleReference.expression)
    ) {
      push(node.moduleReference.expression.text, node)
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      isLiteralSpecifier(node.moduleSpecifier)
    ) {
      push(node.moduleSpecifier.text, node)
    } else if (ts.isCallExpression(node)) {
      const [arg] = node.arguments
      if (arg && isLiteralSpecifier(arg)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          push(arg.text, node)
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          push(arg.text, node)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return records
}
