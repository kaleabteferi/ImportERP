// src/lib/spreadsheet.ts — a small self-contained formula engine: tokenizer,
// recursive-descent parser, and evaluator with per-recalculation circular-
// reference detection. No external dependency — this is deliberately a
// scoped subset of Excel syntax (arithmetic, comparisons, string
// concatenation with &, ranges, and a handful of aggregate/logic functions),
// not a full spreadsheet implementation.

export interface CellError { error: string }
export type CellValue = number | string | boolean | CellError | null
export type CellMap = Record<string, string>

export function isCellError(v: CellValue): v is CellError {
  return typeof v === 'object' && v !== null && 'error' in v
}

// ---- Cell reference helpers -------------------------------------------

const REF_RE = /^([A-Z]+)([0-9]+)$/

export function colLetterToIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1 // 0-based
}

export function colIndexToLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function parseRef(ref: string): { col: number; row: number } | null {
  const m = REF_RE.exec(ref)
  if (!m) return null
  return { col: colLetterToIndex(m[1]), row: parseInt(m[2], 10) - 1 }
}

export function cellId(col: number, row: number): string {
  return `${colIndexToLetter(col)}${row + 1}`
}

export function expandRange(start: string, end: string): string[] {
  const a = parseRef(start), b = parseRef(end)
  if (!a || !b) throw new Error(`#REF! invalid range ${start}:${end}`)
  const refs: string[] = []
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) {
      refs.push(cellId(c, r))
    }
  }
  return refs
}

// ---- Tokenizer -----------------------------------------------------------

type TokenType = 'NUMBER' | 'STRING' | 'REF' | 'IDENT' | 'OP' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'COLON'
interface Token { type: TokenType; value: string }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '(') { tokens.push({ type: 'LPAREN', value: c }); i++; continue }
    if (c === ')') { tokens.push({ type: 'RPAREN', value: c }); i++; continue }
    if (c === ',') { tokens.push({ type: 'COMMA', value: c }); i++; continue }
    if (c === ':') { tokens.push({ type: 'COLON', value: c }); i++; continue }
    if ('+-*/^&'.includes(c)) { tokens.push({ type: 'OP', value: c }); i++; continue }
    if (c === '>' || c === '<' || c === '=') {
      let op = c; i++
      if ((c === '>' || c === '<') && src[i] === '=') { op += '='; i++ }
      else if (c === '<' && src[i] === '>') { op += '>'; i++ }
      tokens.push({ type: 'OP', value: op }); continue
    }
    if (c === '"') {
      i++
      let s = ''
      while (i < src.length && src[i] !== '"') { s += src[i]; i++ }
      i++
      tokens.push({ type: 'STRING', value: s }); continue
    }
    if (/[0-9.]/.test(c)) {
      let n = ''
      while (i < src.length && /[0-9.]/.test(src[i])) { n += src[i]; i++ }
      tokens.push({ type: 'NUMBER', value: n }); continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = ''
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) { s += src[i]; i++ }
      const upper = s.toUpperCase()
      if (REF_RE.test(upper)) tokens.push({ type: 'REF', value: upper })
      else tokens.push({ type: 'IDENT', value: upper })
      continue
    }
    throw new Error(`#ERROR! unexpected "${c}"`)
  }
  return tokens
}

// ---- Parser (recursive descent, precedence climbing) ---------------------

type Node =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'ref'; value: string }
  | { type: 'range'; start: string; end: string }
  | { type: 'unary'; op: string; operand: Node }
  | { type: 'binary'; op: string; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[] }

class Parser {
  private pos = 0
  private tokens: Token[]
  constructor(tokens: Token[]) { this.tokens = tokens }
  private peek() { return this.tokens[this.pos] }
  private next() { return this.tokens[this.pos++] }
  private expect(type: TokenType): Token {
    const t = this.next()
    if (!t || t.type !== type) throw new Error(`#ERROR! expected ${type}`)
    return t
  }

  parse(): Node {
    const node = this.parseComparison()
    if (this.pos < this.tokens.length) throw new Error('#ERROR! unexpected trailing input')
    return node
  }

  private parseComparison(): Node {
    let left = this.parseConcat()
    while (this.peek()?.type === 'OP' && ['=', '<>', '<', '>', '<=', '>='].includes(this.peek().value)) {
      const op = this.next().value
      left = { type: 'binary', op, left, right: this.parseConcat() }
    }
    return left
  }

  private parseConcat(): Node {
    let left = this.parseAdditive()
    while (this.peek()?.type === 'OP' && this.peek().value === '&') {
      this.next()
      left = { type: 'binary', op: '&', left, right: this.parseAdditive() }
    }
    return left
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative()
    while (this.peek()?.type === 'OP' && ['+', '-'].includes(this.peek().value)) {
      const op = this.next().value
      left = { type: 'binary', op, left, right: this.parseMultiplicative() }
    }
    return left
  }

  private parseMultiplicative(): Node {
    let left = this.parsePower()
    while (this.peek()?.type === 'OP' && ['*', '/'].includes(this.peek().value)) {
      const op = this.next().value
      left = { type: 'binary', op, left, right: this.parsePower() }
    }
    return left
  }

  private parsePower(): Node {
    let left = this.parseUnary()
    while (this.peek()?.type === 'OP' && this.peek().value === '^') {
      this.next()
      left = { type: 'binary', op: '^', left, right: this.parseUnary() }
    }
    return left
  }

  private parseUnary(): Node {
    if (this.peek()?.type === 'OP' && (this.peek().value === '-' || this.peek().value === '+')) {
      const op = this.next().value
      return { type: 'unary', op, operand: this.parseUnary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): Node {
    const t = this.peek()
    if (!t) throw new Error('#ERROR! incomplete formula')
    if (t.type === 'NUMBER') { this.next(); return { type: 'number', value: parseFloat(t.value) } }
    if (t.type === 'STRING') { this.next(); return { type: 'string', value: t.value } }
    if (t.type === 'LPAREN') { this.next(); const e = this.parseComparison(); this.expect('RPAREN'); return e }
    if (t.type === 'REF') {
      this.next()
      if (this.peek()?.type === 'COLON') {
        this.next()
        const end = this.expect('REF')
        return { type: 'range', start: t.value, end: end.value }
      }
      return { type: 'ref', value: t.value }
    }
    if (t.type === 'IDENT') {
      this.next()
      this.expect('LPAREN')
      const args: Node[] = []
      if (this.peek() && this.peek().type !== 'RPAREN') {
        args.push(this.parseComparison())
        while (this.peek()?.type === 'COMMA') { this.next(); args.push(this.parseComparison()) }
      }
      this.expect('RPAREN')
      return { type: 'call', name: t.value, args }
    }
    throw new Error(`#ERROR! unexpected "${t.value}"`)
  }
}

// ---- Evaluation ------------------------------------------------------

function toNumber(v: CellValue): number {
  if (isCellError(v)) throw new Error(v.error)
  if (v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number(v)
  if (isNaN(n)) throw new Error('#VALUE!')
  return n
}

function toStr(v: CellValue): string {
  if (isCellError(v)) throw new Error(v.error)
  if (v === null) return ''
  return String(v)
}

function isTruthy(v: CellValue): boolean {
  if (isCellError(v)) throw new Error(v.error)
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v === null) return false
  return v.length > 0
}

type CellGetter = (ref: string) => CellValue

function flattenArgs(args: Node[], getCell: CellGetter): CellValue[] {
  const out: CellValue[] = []
  for (const a of args) {
    if (a.type === 'range') for (const ref of expandRange(a.start, a.end)) out.push(getCell(ref))
    else out.push(evalNode(a, getCell))
  }
  return out
}

function evalFunction(name: string, args: Node[], getCell: CellGetter): CellValue {
  switch (name) {
    case 'SUM': return flattenArgs(args, getCell).reduce((s: number, v) => s + (typeof v === 'number' ? v : (v === null ? 0 : toNumber(v))), 0)
    case 'AVERAGE': {
      const nums = flattenArgs(args, getCell).filter(v => v !== null).map(toNumber)
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
    }
    case 'MIN': {
      const nums = flattenArgs(args, getCell).filter(v => v !== null).map(toNumber)
      return nums.length > 0 ? Math.min(...nums) : 0
    }
    case 'MAX': {
      const nums = flattenArgs(args, getCell).filter(v => v !== null).map(toNumber)
      return nums.length > 0 ? Math.max(...nums) : 0
    }
    case 'COUNT': return flattenArgs(args, getCell).filter(v => typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)))).length
    case 'PRODUCT': return flattenArgs(args, getCell).filter(v => v !== null).map(toNumber).reduce((a, b) => a * b, 1)
    case 'MEDIAN': {
      const nums = flattenArgs(args, getCell).filter(v => v !== null).map(toNumber).sort((a, b) => a - b)
      if (nums.length === 0) return 0
      const mid = Math.floor(nums.length / 2)
      return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
    }
    case 'ROUND': {
      if (args.length < 1) throw new Error('#ERROR! ROUND needs a value')
      const v = toNumber(evalNode(args[0], getCell))
      const d = args[1] ? toNumber(evalNode(args[1], getCell)) : 0
      const f = Math.pow(10, d)
      return Math.round(v * f) / f
    }
    case 'ABS': return Math.abs(toNumber(evalNode(args[0], getCell)))
    case 'IF': {
      if (args.length < 2) throw new Error('#ERROR! IF needs a condition and a result')
      const cond = isTruthy(evalNode(args[0], getCell))
      if (cond) return evalNode(args[1], getCell)
      return args[2] !== undefined ? evalNode(args[2], getCell) : false
    }
    default: throw new Error(`#NAME? unknown function ${name}`)
  }
}

function evalNode(node: Node, getCell: CellGetter): CellValue {
  switch (node.type) {
    case 'number': return node.value
    case 'string': return node.value
    case 'ref': return getCell(node.value)
    case 'range': throw new Error('#VALUE! a range can only be used inside a function like SUM()')
    case 'unary': {
      const n = toNumber(evalNode(node.operand, getCell))
      return node.op === '-' ? -n : n
    }
    case 'binary': {
      if (node.op === '&') return toStr(evalNode(node.left, getCell)) + toStr(evalNode(node.right, getCell))
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) {
        const l = evalNode(node.left, getCell), r = evalNode(node.right, getCell)
        const bothNumeric = (typeof l === 'number' || l === null) && (typeof r === 'number' || r === null)
        const ln = bothNumeric ? toNumber(l) : null, rn = bothNumeric ? toNumber(r) : null
        const cmp = bothNumeric ? (ln! - rn!) : toStr(l).localeCompare(toStr(r))
        switch (node.op) {
          case '=': return cmp === 0
          case '<>': return cmp !== 0
          case '<': return cmp < 0
          case '>': return cmp > 0
          case '<=': return cmp <= 0
          case '>=': return cmp >= 0
        }
      }
      const l = toNumber(evalNode(node.left, getCell)), r = toNumber(evalNode(node.right, getCell))
      switch (node.op) {
        case '+': return l + r
        case '-': return l - r
        case '*': return l * r
        case '/': if (r === 0) throw new Error('#DIV/0!'); return l / r
        case '^': return Math.pow(l, r)
      }
      throw new Error('#ERROR!')
    }
    case 'call': return evalFunction(node.name, node.args, getCell)
  }
}

export function evalFormula(formula: string, getCell: CellGetter): CellValue {
  const tokens = tokenize(formula)
  if (tokens.length === 0) return null
  const ast = new Parser(tokens).parse()
  return evalNode(ast, getCell)
}

// ---- Whole-sheet evaluation with circular-reference detection ------------

export function evaluateSheet(cells: CellMap): Record<string, CellValue> {
  const cache = new Map<string, CellValue>()
  const evaluating = new Set<string>()

  function getCellValue(ref: string): CellValue {
    if (cache.has(ref)) return cache.get(ref)!
    if (evaluating.has(ref)) return { error: '#CIRCULAR!' }
    const raw = cells[ref]
    if (raw === undefined || raw.trim() === '') { cache.set(ref, null); return null }

    evaluating.add(ref)
    let result: CellValue
    if (raw.startsWith('=')) {
      try {
        result = evalFormula(raw.slice(1), getCellValue)
      } catch (e: any) {
        result = { error: e?.message ?? '#ERROR!' }
      }
    } else {
      const trimmed = raw.trim()
      const n = Number(trimmed)
      result = trimmed !== '' && !isNaN(n) ? n : raw
    }
    evaluating.delete(ref)
    cache.set(ref, result)
    return result
  }

  for (const ref of Object.keys(cells)) getCellValue(ref)
  return Object.fromEntries(cache)
}

export function formatCellValue(v: CellValue | undefined): string {
  if (v === undefined || v === null) return ''
  if (isCellError(v)) return v.error
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  return v
}
