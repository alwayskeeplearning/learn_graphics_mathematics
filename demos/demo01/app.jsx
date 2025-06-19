import { useState, useCallback } from 'react';
import { Button } from 'antd';
import { sum } from '@';
import { Button as Button11 } from '@/button';
import styles from './index.less';

const App = () => {
  const [result, setResult] = useState(0);
  const clickHandler = useCallback(() => {
    setResult(sum(2, 2));
  }, []);

  return (
    <>
      {result}
      <Button className={styles.content} onClick={clickHandler}>
        sum
      </Button>
      <Button11 />
    </>
  );
};

export default App;
