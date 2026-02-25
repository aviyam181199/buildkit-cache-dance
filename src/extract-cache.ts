import { promises as fs } from 'fs';
import path from 'path';
import { CacheOptions, Opts, getBuilder, getCacheMap, getMountArgsString, getTargetPath } from './opts.js';
import { run, runPiped } from './run.js';

async function extractCache(cacheSource: string, cacheOptions: CacheOptions, scratchDir: string, containerImage: string, builder: string) {
    // Prepare Timestamp for Layer Cache Busting
    const date = new Date().toISOString();

    await fs.mkdir(scratchDir, { recursive: true });
    await fs.writeFile(path.join(scratchDir, 'buildstamp'), date);

    // Prepare Dancefile to Access Caches
    const targetPath = getTargetPath(cacheOptions);
    const mountArgs = getMountArgsString(cacheOptions);

    const dancefileContent = `
FROM ${containerImage}
COPY buildstamp buildstamp
RUN --mount=${mountArgs} \
    mkdir -p /var/dance-cache/ \
    && cp -p -R ${targetPath}/. /var/dance-cache/ || true
`;
    await fs.writeFile(path.join(scratchDir, 'Dancefile.extract'), dancefileContent);
    console.log(dancefileContent);

    // Clean destination and extract cache directly via tar stream.
    // This avoids the v3.3.1 hang caused by FROM scratch + --output type=local
    // and is simpler than v3.3.0's load + container + docker cp approach.
    await run('sudo', ['rm', '-rf', cacheSource]);
    await fs.mkdir(cacheSource, { recursive: true });
    await runPiped(
        ['docker', ['buildx', 'build', '--builder', builder, '-f', path.join(scratchDir, 'Dancefile.extract'), '--output', 'type=tar,dest=-', scratchDir]],
        ['tar', ['-x', '--strip-components=2', '-C', cacheSource, 'var/dance-cache']]
    );
}

export async function extractCaches(opts: Opts) {
    if (opts["skip-extraction"]) {
        console.log("skip-extraction is set. Skipping extraction step...");
        return;
    }

    const cacheMap = await getCacheMap(opts);
    const scratchDir = opts['scratch-dir'];
    const containerImage = opts['utility-image'];
    const builder = getBuilder(opts);

    // Extract Caches for each source-target pair
    for (const [cacheSource, cacheOptions] of Object.entries(cacheMap)) {
        await extractCache(cacheSource, cacheOptions, scratchDir, containerImage, builder);
    }
}
