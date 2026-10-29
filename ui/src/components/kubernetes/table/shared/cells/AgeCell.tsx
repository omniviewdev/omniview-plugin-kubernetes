import React from 'react';

import { useAge } from '../../../../../utils/ageClock';

const AgeCell: React.FC<{ value: string }> = ({ value }) => {
  const time = useAge(value);
  return <>{time}</>;
};

export default AgeCell;
