// To return the report builder to the interface, set builder to true and deploy.
// Existing browser templates/history are retained; these flags only control access/UI.
export const reportFeatures = {
 builder:false,
 saved:false,
 history:false,
 sources:false
};
export const viewEnabled = view=>!(view in reportFeatures)||reportFeatures[view];
