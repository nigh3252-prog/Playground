// Ordinary GLBs never load or initialize the decoder.
export async function parseSelectedGLB(loader, bytes, base, compression) {
  if (compression === 'meshopt') {
    const {MeshoptDecoder} = await import('./vendor/meshoptimizer/meshopt_decoder.mjs');
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader.parseAsync(bytes,base);
}
