# r6 benchmark data contracts

- Terrain reference: existing Mapzen/AWS Terrarium build-time source.
- U.S. observed water/major flowlines: USGS 3DHP `FeatureServer` layers 60 / 50, fetched only by the build script and rasterized into compact packs. Inland lakes are withheld from the model and used as benchmark truth; ocean/Great-Lake type water may be used only as crop boundary conditions.
- Population sanity check: Natural Earth populated places (`POP_MAX`) because it is public-domain and requires no account/API key. Modern population is deliberately a weak validation signal, not a calibration target for preindustrial Stage 4.

Implementation should fail its build if a real-data request fails. Never substitute generated geography for a missing benchmark.
