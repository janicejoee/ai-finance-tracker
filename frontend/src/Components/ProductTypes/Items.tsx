import React from "react";

import Endpoint from "../Endpoint";
import ProductTypesContainer from "./ProductTypesContainer";
import {
  transformAccountsData,
  accountsCategories,
} from "../../dataUtilities";

const Items = () => (
  <ProductTypesContainer productType="Accounts">
    <Endpoint
      endpoint="accounts"
      method="GET"
      name="Accounts"
      schema="/accounts/get"
      categories={accountsCategories}
      description="Retrieve information about all accounts associated with your linked bank."
      transformData={transformAccountsData}
    />
  </ProductTypesContainer>
);

Items.displayName = "Items";

export default Items;
