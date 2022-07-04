import * as ts from "typescript"
import * as fs from "fs"
import * as utils from "tsutils";

// given an import, returns if it imports the given module.
function createModuleImportMatcher(moduleName: string) {
    return (node: ts.Node): node is ts.ImportDeclaration =>
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === moduleName
}

function createExportKeywordMatcher(moduleName: string = 'Instance') {
    return (node: ts.Node): node is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(node) &&
        ts.isTypeReferenceNode(node.type) &&
        ts.isIdentifier(node.type.typeName) &&
        node.type.typeName.escapedText === moduleName
}

// is a property access?
function createPropertyAccessMatcher(
    propertyName: string
) {
    return (node: ts.Node) =>
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ts.isIdentifier(node.name) &&
        node.expression.escapedText === 'types' &&
        node.name.escapedText === propertyName
}

// create a visitor that replace the this. with an identifier.
function createReplaceThisWithIdentifierVisitor(
    replacement: ts.Identifier,
    context: ts.TransformationContext
) {
    return function self(node: ts.Node) {
        if (node.kind === ts.SyntaxKind.ThisKeyword) {
            return replacement
        }
        return ts.visitEachChild(node, self, context)
    }
}

// create a visitor that replace the this.action with its name.
function createReplaceThisActionWithIdentifierVisitor(
    actionNames: string[],
    context: ts.TransformationContext
) {
    return function self(node: ts.Node) {
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
            if (
                actionNames.indexOf(node.name.text) > -1 &&
                node.expression.kind === ts.SyntaxKind.ThisKeyword
            ) {
                return node.name
            }
        }
        return ts.visitEachChild(node, self, context)
    }
}

function createGetInitialValue(context: ts.TransformationContext) {
    const arrayPropertyAccessMatch = createPropertyAccessMatcher('array');
    const modelPropertyAccessMatch = createPropertyAccessMatcher('model');
    return function getInitialValue(node: ts.PropertyAssignment) {
        const initializer = node.initializer as ts.CallExpression;
        
        if (!initializer.arguments || !Array.isArray(initializer.arguments)) {
            return node;
        }

        // basic type
        for (let i = 0; i < initializer.arguments.length; i++) {
            const arg = initializer.arguments[i];
            if (
                ts.isStringLiteral(arg) ||
                ts.isArrayLiteralExpression(arg) ||
                ts.isNumericLiteral(arg) ||
                arg.kind === ts.SyntaxKind.FalseKeyword ||
                arg.kind === ts.SyntaxKind.TrueKeyword
            ) {
                return context.factory.createPropertyAssignment(
                    node.name, arg
                );
            }
        }

        // types.array(...)
        if(arrayPropertyAccessMatch(initializer.expression)) {
            return context.factory.createPropertyAssignment(
                node.name,
                context.factory.createArrayLiteralExpression()
            );
        }

        // types.model(...)
        if(modelPropertyAccessMatch(initializer.expression)){
            return context.factory.createPropertyAssignment(
                node.name,
                modTypesModelCall(initializer, context)
            );
        }

        return context.factory.createPropertyAssignment(
            node.name,
            node.initializer
        );
    };
}

// change the actual types.model signature
function modTypesModelCall(node: ts.CallExpression, context: ts.TransformationContext) {

    // a place for all the nodes
    let nameNode: null | ts.StringLiteral = null
    let propertiesNode: null | ts.ObjectLiteralExpression = null
    let stateNode: null | ts.ObjectLiteralExpression = null
    let actionsNode: null | ts.ObjectLiteralExpression = null

    for (let i = 0; i < node.arguments.length; i++) {
        const j = node.arguments[i]

        // is a model name?
        if (i === 0 && ts.isStringLiteral(j)) {
            nameNode = j
            continue
        }
        // is a properties node?
        if (!propertiesNode && ts.isObjectLiteralExpression(j)) {
            propertiesNode = j
            continue
        }
        // last is actions
        if (!actionsNode && i === node.arguments.length - 1 && ts.isObjectLiteralExpression(j)) {
            actionsNode = j
            continue
        }
        // any other is local state
        if (ts.isObjectLiteralExpression(j)) {
            stateNode = j
        }
    }

    if (propertiesNode) {

        const viewsNodes = propertiesNode.properties.filter(
            property => ts.isPropertyAssignment(property)
        )

        if (viewsNodes.length > 0) {

            const newViews = viewsNodes.map(node => ts.visitNode(node, createGetInitialValue(context)))

            // TODO: eventually handle circular dependencies
            return context.factory.createObjectLiteralExpression(
                [].concat(newViews), true
            )
        }
    }

    return;

}

// change the `import ... from 'mobx-state-tree'` to `import { makeAutoObservable } from 'mobx'`
function modMSTImport(_node: ts.ImportDeclaration, context: ts.TransformationContext) {
    const {
        createImportDeclaration,
        createImportClause,
        createNamedImports,
        createImportSpecifier,
        createIdentifier,
        createStringLiteral,
    } = context.factory;
    return createImportDeclaration(
        undefined,
        undefined,
        createImportClause(
            false,
            undefined,
            createNamedImports([
                createImportSpecifier(
                    false,
                    undefined,
                    createIdentifier("makeAutoObservable")
                )
            ])
        ),
        createStringLiteral("mobx", false)
    );
}

// Instance
function modMSTTypeReference(_node: ts.TypeAliasDeclaration, context: ts.TransformationContext) {
    return context.factory.createJsxText('');
}

function runCodemod(fileNames: string[], options: ts.CompilerOptions) {
    const mobxStateTreeImportMatcher = createModuleImportMatcher("mobx-state-tree")
    const isExportKeywordMatcher = createExportKeywordMatcher()
    const isModelAccessMatcher = createPropertyAccessMatcher('model');

    const transformer = <T extends ts.Node>(context: ts.TransformationContext) => (rootNode: T) => {

        function visit(node: ts.Node): ts.Node {
            // is a MST import?
            if (mobxStateTreeImportMatcher(node)) {
                return modMSTImport(node, context)
            }

            // is export Instance Type
            if (isExportKeywordMatcher(node)) {
                return modMSTTypeReference(node, context)
            }

            // is this a types.model call?
            if (ts.isCallExpression(node)) {
                // ensure that we are using .model over the types
                if (isModelAccessMatcher(node.expression)) {
                    // ok, this is a types.model call! W00T!
                    return modTypesModelCall(node, context)
                }
            }

            return ts.visitEachChild(node, visit, context)
        }

        return ts.visitNode(rootNode, visit)
    }

    // run for each file
    for (const fileName of fileNames) {
        // create the file source
        const sourceFile = ts.createSourceFile(
            fileName,
            fs.readFileSync(fileName).toString(),
            ts.ScriptTarget.Latest
        )
        // log it
        console.log("Running codemod over", fileName)
        // make the AST transforms
        const transformed = ts.transform(sourceFile, [transformer])
        // output the code
        const printer = ts.createPrinter({
            newLine: ts.NewLineKind.LineFeed
        })
        const result = printer.printNode(
            ts.EmitHint.Unspecified,
            transformed.transformed[0],
            sourceFile
        )
        // copy the file to a backup
        fs.writeFileSync(fileName + ".bak", fs.readFileSync(fileName).toString())
        fs.writeFileSync(fileName, result)
    }
}

// run from command line as
// node script.js file-to-codemod.js
// a new file with the suffix of .new will be created for you

export default runCodemod;
