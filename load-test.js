import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-arrival-rate',

      startRate: 100,
      timeUnit: '1s',

      stages: [
        { target: 200, duration: '10s' },
        { target: 500, duration: '30s' },
        { target: 1000, duration: '30s' },
        { target: 5000, duration: '30s' },
        { target: 7000, duration: '30s' },
      ],

      preAllocatedVUs: 200,
      maxVUs: 2000,
    },
  },

  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const response = http.get(
    'https://sukhdeopalace.com/about.html'
  );

  check(response, {
    'HTTP 200': (r) => r.status === 200,
  });
}