import type { Part } from './blueprint.ts'

export function contourPath(part: Extract<Part, { forma: 'contorno' }>): string {
  const left = part.x - part.largura / 2
  const top = -part.y - part.altura
  const point = (x: number, y: number) => `${left + part.largura * x / 100} ${top + part.altura * y / 100}`
  return part.tracado.map(step => {
    switch (step.op) {
      case 'M':
      case 'L':
        return `${step.op}${point(step.x, step.y)}`
      case 'Q':
        return `Q${point(step.cx, step.cy)} ${point(step.x, step.y)}`
      case 'C':
        return `C${point(step.cx, step.cy)} ${point(step.dx, step.dy)} ${point(step.x, step.y)}`
      case 'Z':
        return 'Z'
    }
  }).join(' ')
}
