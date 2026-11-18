const params = new URLSearchParams(location.search);

if (params.has('dev')) {
  import('./dev/harness').then((m) => m.runHarness(params));
} else {
  import('./ui/boot').then((m) => m.boot());
}
