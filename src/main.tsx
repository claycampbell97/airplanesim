const params = new URLSearchParams(location.search);
const dev = params.get('dev');

if (dev === 'globe') {
  import('./dev/harness').then((m) => m.runHarness(params));
} else if (dev === 'aircraft') {
  import('./dev/aircraftHarness').then((m) => m.runAircraftHarness(params));
} else {
  import('./ui/boot').then((m) => m.boot());
}
