"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertAST2UmlClasses = void 0;
const path = __importStar(require("path"));
const umlClass_1 = require("./umlClass");
const typeGuards_1 = require("./typeGuards");
const debug = require('debug')('sol2uml');
function convertAST2UmlClasses(node, relativePath, filesystem = false) {
    let umlClasses = [];
    const importedPaths = [];
    if (node.type === 'SourceUnit') {
        node.children.forEach((childNode) => {
            if (childNode.type === 'ContractDefinition') {
                debug(`Adding contract ${childNode.name}`);
                let umlClass = new umlClass_1.UmlClass({
                    name: childNode.name,
                    absolutePath: filesystem
                        ? path.resolve(relativePath) // resolve the absolute path
                        : relativePath,
                    relativePath,
                });
                umlClass = parseContractDefinition(umlClass, childNode);
                umlClasses.push(umlClass);
            }
            else if (childNode.type === 'StructDefinition') {
                debug(`Adding struct ${childNode.name}`);
                let umlClass = new umlClass_1.UmlClass({
                    name: childNode.name,
                    stereotype: umlClass_1.ClassStereotype.Struct,
                    absolutePath: filesystem
                        ? path.resolve(relativePath) // resolve the absolute path
                        : relativePath,
                    relativePath,
                });
                umlClass = parseStructDefinition(umlClass, childNode);
                umlClasses.push(umlClass);
            }
            else if (childNode.type === 'EnumDefinition') {
                debug(`Adding enum ${childNode.name}`);
                let umlClass = new umlClass_1.UmlClass({
                    name: childNode.name,
                    stereotype: umlClass_1.ClassStereotype.Enum,
                    absolutePath: filesystem
                        ? path.resolve(relativePath) // resolve the absolute path
                        : relativePath,
                    relativePath,
                });
                umlClass = parseEnumDefinition(umlClass, childNode);
                umlClasses.push(umlClass);
            }
            else if (childNode.type === 'ImportDirective') {
                const codeFolder = path.dirname(relativePath);
                if (filesystem) {
                    // resolve the imported file from the folder sol2uml was run against
                    try {
                        const importPath = require.resolve(childNode.path, {
                            paths: [codeFolder],
                        });
                        importedPaths.push(importPath);
                    }
                    catch (err) {
                        debug(`Failed to resolve import ${childNode.path} from file ${relativePath}`);
                    }
                }
                else {
                    // this has come from Etherscan
                    const importPath = path.join(codeFolder, childNode.path);
                    importedPaths.push(importPath);
                }
            }
        });
    }
    else {
        throw new Error(`AST node not of type SourceUnit`);
    }
    umlClasses.forEach((umlClass) => {
        umlClass.importedPaths = importedPaths;
    });
    return umlClasses;
}
exports.convertAST2UmlClasses = convertAST2UmlClasses;
function parseStructDefinition(umlClass, node) {
    node.members.forEach((member) => {
        const [type, attributeType] = parseTypeName(member.typeName);
        umlClass.attributes.push({
            name: member.name,
            type,
            attributeType,
        });
    });
    // Recursively parse struct members for associations
    umlClass = addAssociations(node.members, umlClass);
    return umlClass;
}
function parseEnumDefinition(umlClass, node) {
    let index = 0;
    node.members.forEach((member) => {
        umlClass.attributes.push({
            name: member.name,
            type: (index++).toString(),
        });
    });
    // Recursively parse struct members for associations
    umlClass = addAssociations(node.members, umlClass);
    return umlClass;
}
function parseContractDefinition(umlClass, node) {
    umlClass.stereotype = parseContractKind(node.kind);
    // For each base contract
    node.baseContracts.forEach((baseClass) => {
        // Add a realization association
        umlClass.addAssociation({
            referenceType: umlClass_1.ReferenceType.Storage,
            targetUmlClassName: baseClass.baseName.namePath,
            realization: true,
        });
    });
    // For each sub node
    node.subNodes.forEach((subNode) => {
        if (typeGuards_1.isStateVariableDeclaration(subNode)) {
            subNode.variables.forEach((variable) => {
                const [type, attributeType] = parseTypeName(variable.typeName);
                const valueStore = 
                // @ts-ignore isImmutable is available at runtime but not in VariableDeclaration
                variable.isDeclaredConst || variable.isImmutable;
                umlClass.attributes.push({
                    visibility: parseVisibility(variable.visibility),
                    name: variable.name,
                    type,
                    attributeType,
                    compiled: valueStore,
                });
            });
            // Recursively parse variables for associations
            umlClass = addAssociations(subNode.variables, umlClass);
        }
        else if (typeGuards_1.isUsingForDeclaration(subNode)) {
            // Add association to library contract
            umlClass.addAssociation({
                referenceType: umlClass_1.ReferenceType.Memory,
                targetUmlClassName: subNode.libraryName,
            });
        }
        else if (typeGuards_1.isFunctionDefinition(subNode)) {
            if (subNode.isConstructor) {
                umlClass.operators.push({
                    name: 'constructor',
                    stereotype: umlClass_1.OperatorStereotype.None,
                    parameters: parseParameters(subNode.parameters),
                });
            }
            // If a fallback function
            else if (subNode.name === '') {
                umlClass.operators.push({
                    name: '',
                    stereotype: umlClass_1.OperatorStereotype.Fallback,
                    parameters: parseParameters(subNode.parameters),
                    isPayable: parsePayable(subNode.stateMutability),
                });
            }
            else {
                let stereotype = umlClass_1.OperatorStereotype.None;
                if (subNode.body === null) {
                    stereotype = umlClass_1.OperatorStereotype.Abstract;
                }
                else if (subNode.stateMutability === 'payable') {
                    stereotype = umlClass_1.OperatorStereotype.Payable;
                }
                umlClass.operators.push({
                    visibility: parseVisibility(subNode.visibility),
                    name: subNode.name,
                    stereotype,
                    parameters: parseParameters(subNode.parameters),
                    returnParameters: parseParameters(subNode.returnParameters),
                });
            }
            // Recursively parse function parameters for associations
            umlClass = addAssociations(subNode.parameters, umlClass);
            if (subNode.returnParameters) {
                umlClass = addAssociations(subNode.returnParameters, umlClass);
            }
            // If no body to the function, it must be either an Interface or Abstract
            if (subNode.body === null) {
                if (umlClass.stereotype !== umlClass_1.ClassStereotype.Interface) {
                    // If not Interface, it must be Abstract
                    umlClass.stereotype = umlClass_1.ClassStereotype.Abstract;
                }
            }
            else {
                // Recursively parse function statements for associations
                umlClass = addAssociations(subNode.body.statements, umlClass);
            }
        }
        else if (typeGuards_1.isModifierDefinition(subNode)) {
            umlClass.operators.push({
                stereotype: umlClass_1.OperatorStereotype.Modifier,
                name: subNode.name,
                parameters: parseParameters(subNode.parameters),
            });
            if (subNode.body && subNode.body.statements) {
                // Recursively parse modifier statements for associations
                umlClass = addAssociations(subNode.body.statements, umlClass);
            }
        }
        else if (typeGuards_1.isEventDefinition(subNode)) {
            umlClass.operators.push({
                stereotype: umlClass_1.OperatorStereotype.Event,
                name: subNode.name,
                parameters: parseParameters(subNode.parameters),
            });
            // Recursively parse event parameters for associations
            umlClass = addAssociations(subNode.parameters, umlClass);
        }
        else if (typeGuards_1.isStructDefinition(subNode)) {
            let structMembers = [];
            subNode.members.forEach((member) => {
                const [type, attributeType] = parseTypeName(member.typeName);
                structMembers.push({
                    name: member.name,
                    type,
                    attributeType,
                });
            });
            umlClass.structs[subNode.name] = structMembers;
            // Recursively parse members for associations
            umlClass = addAssociations(subNode.members, umlClass);
        }
        else if (typeGuards_1.isEnumDefinition(subNode)) {
            let enumValues = [];
            subNode.members.forEach((member) => {
                enumValues.push(member.name);
            });
            umlClass.enums[subNode.name] = enumValues;
        }
    });
    return umlClass;
}
// Recursively parse AST nodes for associations
function addAssociations(nodes, umlClass) {
    if (!nodes || !Array.isArray(nodes)) {
        debug('Warning - can not recursively parse AST nodes for associations. Invalid nodes array');
        return umlClass;
    }
    for (const node of nodes) {
        // Some variables can be null. eg var (lad,,,) = tub.cups(cup);
        if (node === null) {
            break;
        }
        // Recursively parse sub nodes that can has variable declarations
        switch (node.type) {
            case 'VariableDeclaration':
                if (!node.typeName) {
                    break;
                }
                if (node.typeName.type === 'UserDefinedTypeName') {
                    // If state variable then mark as a Storage reference, else Memory
                    const referenceType = node.isStateVar
                        ? umlClass_1.ReferenceType.Storage
                        : umlClass_1.ReferenceType.Memory;
                    // Library references can have a Library dot variable notation. eg Set.Data
                    const targetUmlClassName = parseClassName(node.typeName.namePath);
                    umlClass.addAssociation({
                        referenceType,
                        targetUmlClassName,
                    });
                }
                else if (node.typeName.type === 'Mapping') {
                    umlClass = addAssociations([node.typeName.keyType], umlClass);
                    umlClass = addAssociations([node.typeName.valueType], umlClass);
                }
                break;
            case 'UserDefinedTypeName':
                umlClass.addAssociation({
                    referenceType: umlClass_1.ReferenceType.Memory,
                    targetUmlClassName: node.namePath,
                });
                break;
            case 'Block':
                umlClass = addAssociations(node.statements, umlClass);
                break;
            case 'StateVariableDeclaration':
            case 'VariableDeclarationStatement':
                umlClass = addAssociations(node.variables, umlClass);
                umlClass = parseExpression(node.initialValue, umlClass);
                break;
            case 'ForStatement':
                if ('statements' in node.body) {
                    umlClass = addAssociations(node.body.statements, umlClass);
                }
                umlClass = parseExpression(node.conditionExpression, umlClass);
                umlClass = parseExpression(node.loopExpression.expression, umlClass);
                break;
            case 'WhileStatement':
                if ('statements' in node.body) {
                    umlClass = addAssociations(node.body.statements, umlClass);
                }
                break;
            case 'DoWhileStatement':
                if ('statements' in node.body) {
                    umlClass = addAssociations(node.body.statements, umlClass);
                }
                umlClass = parseExpression(node.condition, umlClass);
                break;
            case 'ReturnStatement':
            case 'ExpressionStatement':
                umlClass = parseExpression(node.expression, umlClass);
                break;
            case 'IfStatement':
                if (node.trueBody) {
                    if ('statements' in node.trueBody) {
                        umlClass = addAssociations(node.trueBody.statements, umlClass);
                    }
                    if ('expression' in node.trueBody) {
                        umlClass = parseExpression(node.trueBody.expression, umlClass);
                    }
                }
                if (node.falseBody) {
                    if ('statements' in node.falseBody) {
                        umlClass = addAssociations(node.falseBody.statements, umlClass);
                    }
                    if ('expression' in node.falseBody) {
                        umlClass = parseExpression(node.falseBody.expression, umlClass);
                    }
                }
                umlClass = parseExpression(node.condition, umlClass);
                break;
            default:
                break;
        }
    }
    return umlClass;
}
function parseExpression(expression, umlClass) {
    if (!expression || !expression.type) {
        return umlClass;
    }
    if (expression.type === 'BinaryOperation') {
        umlClass = parseExpression(expression.left, umlClass);
        umlClass = parseExpression(expression.right, umlClass);
    }
    else if (expression.type === 'FunctionCall') {
        umlClass = parseExpression(expression.expression, umlClass);
        expression.arguments.forEach((arg) => {
            umlClass = parseExpression(arg, umlClass);
        });
    }
    else if (expression.type === 'IndexAccess') {
        umlClass = parseExpression(expression.base, umlClass);
        umlClass = parseExpression(expression.index, umlClass);
    }
    else if (expression.type === 'TupleExpression') {
        expression.components.forEach((component) => {
            umlClass = parseExpression(component, umlClass);
        });
    }
    else if (expression.type === 'MemberAccess') {
        umlClass = parseExpression(expression.expression, umlClass);
    }
    else if (expression.type === 'Conditional') {
        umlClass = addAssociations([expression.trueExpression], umlClass);
        umlClass = addAssociations([expression.falseExpression], umlClass);
    }
    else if (expression.type === 'Identifier') {
        umlClass.addAssociation({
            referenceType: umlClass_1.ReferenceType.Memory,
            targetUmlClassName: expression.name,
        });
    }
    else if (expression.type === 'NewExpression') {
        umlClass = addAssociations([expression.typeName], umlClass);
    }
    else if (expression.type === 'UnaryOperation' &&
        expression.subExpression) {
        umlClass = parseExpression(expression.subExpression, umlClass);
    }
    return umlClass;
}
function parseClassName(rawClassName) {
    if (!rawClassName ||
        typeof rawClassName !== 'string' ||
        rawClassName.length === 0) {
        return '';
    }
    // Split the name on dot
    const splitUmlClassName = rawClassName.split('.');
    const umlClassName = splitUmlClassName[0];
    return umlClassName;
}
function parseVisibility(visibility) {
    switch (visibility) {
        case 'default':
            return umlClass_1.Visibility.Public;
        case 'public':
            return umlClass_1.Visibility.Public;
        case 'external':
            return umlClass_1.Visibility.External;
        case 'internal':
            return umlClass_1.Visibility.Internal;
        case 'private':
            return umlClass_1.Visibility.Private;
        default:
            throw Error(`Invalid visibility ${visibility}. Was not public, external, internal or private`);
    }
}
function parseTypeName(typeName) {
    var _a, _b, _c;
    switch (typeName.type) {
        case 'ElementaryTypeName':
            return [typeName.name, umlClass_1.AttributeType.Elementary];
        case 'UserDefinedTypeName':
            return [typeName.namePath, umlClass_1.AttributeType.UserDefined];
        case 'FunctionTypeName':
            // TODO add params and return type
            return [typeName.type + '\\(\\)', umlClass_1.AttributeType.Function];
        case 'ArrayTypeName':
            const [arrayElementType] = parseTypeName(typeName.baseTypeName);
            // Bug in Solidity parser's ArrayTypeName
            // ArrayTypeName.length is `Expression | null`
            // but should be `NumberLiteral | null`
            const length = ((_a = typeName.length) === null || _a === void 0 ? void 0 : _a.number) || '';
            return [arrayElementType + '[' + length + ']', umlClass_1.AttributeType.Array];
        case 'Mapping':
            const key = ((_b = typeName.keyType) === null || _b === void 0 ? void 0 : _b.name) ||
                ((_c = typeName.keyType) === null || _c === void 0 ? void 0 : _c.namePath);
            const [valueType] = parseTypeName(typeName.valueType);
            return [
                'mapping\\(' + key + '=\\>' + valueType + '\\)',
                umlClass_1.AttributeType.Mapping,
            ];
        default:
            throw Error(`Invalid typeName ${typeName}`);
    }
}
function parseParameters(params) {
    if (!params || !params) {
        return [];
    }
    let parameters = [];
    for (const param of params) {
        const [type] = parseTypeName(param.typeName);
        parameters.push({
            name: param.name,
            type,
        });
    }
    return parameters;
}
function parseContractKind(kind) {
    switch (kind) {
        case 'contract':
            return umlClass_1.ClassStereotype.None;
        case 'interface':
            return umlClass_1.ClassStereotype.Interface;
        case 'library':
            return umlClass_1.ClassStereotype.Library;
        case 'abstract':
            return umlClass_1.ClassStereotype.Abstract;
        default:
            throw Error(`Invalid kind ${kind}`);
    }
}
function parsePayable(stateMutability) {
    return stateMutability === 'payable';
}
//# sourceMappingURL=converterAST2Classes.js.map