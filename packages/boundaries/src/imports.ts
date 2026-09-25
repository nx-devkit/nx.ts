import ts from 'typescript'

export interface ImportRecord {
  specifier: string
  line: number
}

/**
 * Collect import specifiers via the TypeScript parser — comments and string
 * literals cannot produce false positives. Covers static import,
 * `export ... from`, dynamic `import()`, and `require()`.
 */
export function collectImports(fileName: string, source: string): ImportRecord[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const records: ImportRecord[] = []
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      records.push({ specifier: node.moduleSpecifier.text, line: lineOf(node.getStart(sf)) })
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      records.push({ specifier: node.moduleSpecifier.text, line: lineOf(node.getStart(sf)) })
    } else if (ts.isCallExpression(node)) {
      const [arg] = node.arguments
      if (arg && ts.isStringLiteral(arg)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          records.push({ specifier: arg.text, line: lineOf(node.getStart(sf)) })
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          records.push({ specifier: arg.text, line: lineOf(node.getStart(sf)) })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return records
}
