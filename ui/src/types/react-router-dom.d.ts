// Published @omniviewdev/runtime declarations still import types from
// react-router-dom. The host provides react-router 8, which owns those exports.
// Drop this once a published runtime declares react-router types directly.
declare module 'react-router-dom' {
  export * from 'react-router';
}
