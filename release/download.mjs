import assert from 'node:assert/strict';

// Manual redirects retain HTTPS and bounded streaming avoids unbounded memory use.
export async function download(url,maxBytes,fetcher=fetch) {
  for(let redirects=0; redirects<=5; redirects++) {
    url=new URL(url);assert.equal(url.protocol,'https:','Artifact downloads require HTTPS');
    assert(!url.username && !url.password,'Artifact URLs must not contain credentials');
    const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(120000)});
    if([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel();
      assert(response.headers.get('location'),'Missing redirect location');
      url=new URL(response.headers.get('location'),url);continue;
    }
    assert(response.ok,`Artifact download failed: ${response.status}`);
    assert(Number(response.headers.get('content-length') || 0)<=maxBytes,'Artifact exceeds size limit');
    let length=0;const chunks=[];
    for await(const chunk of response.body) {
      length+=chunk.length;assert(length<=maxBytes,'Artifact exceeds size limit');chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw Error('Too many artifact redirects');
}
