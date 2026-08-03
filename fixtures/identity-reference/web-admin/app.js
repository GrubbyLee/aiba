(function() {
  var api = window.VehicleApi.createVehicleApi(window.fetch.bind(window));
  var tbody = document.querySelector("[data-vehicle-rows]");
  var status = document.querySelector("[data-status]");
  var count = document.querySelector("[data-count]");

  function cell(value, className) {
    var element = document.createElement("td");
    element.textContent = String(value);
    if (className) element.className = className;
    return element;
  }

  function render(items) {
    tbody.textContent = "";
    count.textContent = String(items.length);
    items.forEach(function(vehicle) {
      var row = document.createElement("tr");
      row.appendChild(cell(vehicle.fleetNumber, "fleet-number"));
      row.appendChild(cell(vehicle.plateNumber));
      row.appendChild(cell(vehicle.make + " " + vehicle.model));
      row.appendChild(cell(vehicle.mileageKm.toLocaleString() + " km"));

      var stateCell = document.createElement("td");
      var select = document.createElement("select");
      ["active", "inactive", "retired"].forEach(function(value) {
        var option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        option.selected = value === vehicle.status;
        select.appendChild(option);
      });
      stateCell.appendChild(select);
      row.appendChild(stateCell);

      var actionCell = document.createElement("td");
      var save = document.createElement("button");
      save.type = "button";
      save.textContent = "Save";
      save.addEventListener("click", function() {
        save.disabled = true;
        api.updateVehicle(vehicle.vehicleId, vehicle.revision, select.value)
          .then(load)
          .catch(function() {
            status.textContent = "Update rejected";
            save.disabled = false;
          });
      });
      actionCell.appendChild(save);
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });
  }

  function load() {
    status.textContent = "Loading";
    return api.listVehicles(100).then(function(result) {
      render(result.items);
      status.textContent = "Current";
    }).catch(function() {
      tbody.textContent = "";
      count.textContent = "0";
      status.textContent = "Unavailable";
    });
  }

  document.querySelector("[data-refresh]").addEventListener("click", load);
  load();
}());
