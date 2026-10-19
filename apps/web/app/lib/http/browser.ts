import axios from 'axios';

export const browserHttp = axios.create({
  adapter: 'fetch',
});
