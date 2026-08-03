(function(root) {
  function createVehicleApi(fetchImpl) {
    function parse(response) {
      if (!response.ok) throw new Error("Vehicle request was rejected");
      return response.json();
    }

    return {
      listVehicles: function(limit) {
        return fetchImpl("/api/vehicles?limit=" + encodeURIComponent(String(limit)), {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        }).then(parse);
      },
      updateVehicle: function(vehicleId, expectedRevision, status) {
        return fetchImpl("/api/vehicles/" + encodeURIComponent(vehicleId), {
          method: "PATCH",
          credentials: "same-origin",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            expectedRevision: expectedRevision,
            status: status,
          }),
        }).then(parse);
      },
    };
  }

  root.VehicleApi = { createVehicleApi: createVehicleApi };
  if (typeof module !== "undefined") module.exports = root.VehicleApi;
}(typeof window !== "undefined" ? window : globalThis));
