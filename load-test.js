import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-arrival-rate',

      startRate: 100,
      timeUnit: '1s',

      stages: [
        { target: 20, duration: '10s' },
        { target: 50, duration: '30s' },
        { target: 100, duration: '30s' },
        { target: 500, duration: '30s' },
        { target: 100, duration: '30s' },
      ],

      preAllocatedVUs: 10,
      maxVUs: 100,
    },
  },

  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const response = http.get(
    'https://jade-sisters-towards-needle.trycloudflare.com/api/v1/chathistory'
  );

  check(response, {
    'HTTP 200': (r) => r.status === 200,
  });
}