/* @flow */

import { baseOptions } from './options'
import { createCompiler } from 'compiler/index'

// 这里通过 createCompiler 函数的返回值解构出 compileToFunctions
const { compile, compileToFunctions } = createCompiler(baseOptions)

export { compile, compileToFunctions }
