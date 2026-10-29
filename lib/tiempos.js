// Mide tramos de un pedido para el header Server-Timing (se ve en DevTools > Network > Timing).
import { performance } from 'node:perf_hooks';

export function crearMedidor() {
  const inicio = performance.now();
  const tramos = [];
  const anotar = (nombre, desde) => tramos.push([nombre, performance.now() - desde]);
  return {
    // `trabajo` puede ser una promesa o una función (sincrónica o async). Devuelve su resultado.
    medir(nombre, trabajo) {
      const desde = performance.now();
      const resultado = typeof trabajo === 'function' ? trabajo() : trabajo;
      if (resultado && typeof resultado.then === 'function') {
        return resultado.finally(() => anotar(nombre, desde));
      }
      anotar(nombre, desde);
      return resultado;
    },
    header() {
      return [...tramos, ['total', performance.now() - inicio]]
        .map(([nombre, ms]) => `${nombre};dur=${ms.toFixed(1)}`)
        .join(', ');
    },
  };
}

// Para cuando no hace falta medir: corre el trabajo y listo.
export const sinMedir = { medir: (_nombre, trabajo) => (typeof trabajo === 'function' ? trabajo() : trabajo) };
